-- BitNode: cálculo y registro de comisiones directas y binarias.
-- Requisitos: ejecutar después de core-model.sql.
-- Si commissions.sql ya fue ejecutado, este archivo reemplaza su función de cálculo.
-- No crea datos de prueba ni elimina registros.

create table if not exists public.commission_events (
  source_event_id text primary key,
  contract_id text not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  amount numeric(18,8) not null check (amount > 0),
  event_type text not null check (event_type in ('contract_confirmed')),
  created_at timestamptz not null default now()
);

create table if not exists public.network_volume (
  user_id uuid not null references auth.users(id) on delete cascade,
  leg text not null check (leg in ('left', 'right')),
  volume numeric(18,8) not null default 0 check (volume >= 0),
  matched_volume numeric(18,8) not null default 0 check (matched_volume >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, leg),
  constraint network_volume_matched_not_above_volume check (matched_volume <= volume)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'network_volume_matched_le_volume'
      and conrelid = 'public.network_volume'::regclass
  ) then
    alter table public.network_volume
      add constraint network_volume_matched_le_volume check (matched_volume <= volume);
  end if;
end;
$$;

create table if not exists public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references auth.users(id) on delete restrict,
  source_user_id uuid not null references auth.users(id) on delete restrict,
  source_event_id text not null references public.commission_events(source_event_id) on delete restrict,
  commission_type text not null check (commission_type in ('direct', 'binary', 'reversal')),
  amount numeric(18,8) not null check (amount <> 0),
  rate numeric(8,6) not null check (rate >= 0 and rate <= 1),
  leg text not null default '' check (leg in ('', 'left', 'right')),
  status text not null default 'credited' check (status in ('credited', 'reversed', 'pending')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_event_id, commission_type, beneficiary_id, leg)
);

create index if not exists commission_ledger_beneficiary_idx
  on public.commission_ledger(beneficiary_id, created_at desc);
create index if not exists commission_ledger_source_event_idx
  on public.commission_ledger(source_event_id);

create or replace function public.process_contract_commissions(
  p_source_event_id text,
  p_contract_id text,
  p_user_id uuid,
  p_amount numeric,
  p_event_type text default 'contract_confirmed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.network_nodes%rowtype;
  v_parent_node public.network_nodes%rowtype;
  v_event_inserted integer;
  v_current uuid := p_user_id;
  v_step integer := 0;
  v_direct numeric := 0;
  v_binary numeric := 0;
  v_commission numeric;
  v_left numeric;
  v_right numeric;
  v_old_matched numeric;
  v_new_matched numeric;
  v_delta numeric;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  ) <> 'service_role' then
    raise exception 'Direct commission processing is restricted to service_role';
  end if;

  if nullif(trim(p_source_event_id), '') is null then
    raise exception 'Source event id is required';
  end if;
  if nullif(trim(p_contract_id), '') is null then
    raise exception 'Contract id is required';
  end if;
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_event_type <> 'contract_confirmed' then
    raise exception 'Only contract_confirmed events are supported';
  end if;

  -- Serializa eventos del mismo usuario para que dos activaciones no consuman
  -- simultáneamente el mismo volumen emparejado.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  insert into public.commission_events(source_event_id, contract_id, user_id, amount, event_type)
  values (trim(p_source_event_id), trim(p_contract_id), p_user_id, p_amount, 'contract_confirmed')
  on conflict (source_event_id) do nothing;
  get diagnostics v_event_inserted = row_count;

  if v_event_inserted = 0 then
    return jsonb_build_object(
      'status', 'duplicate',
      'source_event_id', p_source_event_id,
      'direct', 0,
      'binary', 0
    );
  end if;

  select * into v_node
  from public.network_nodes
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'status', 'processed',
      'source_event_id', p_source_event_id,
      'direct', 0,
      'binary', 0,
      'reason', 'user has no network node'
    );
  end if;

  -- Comisión directa: 10 % al patrocinador inmediato.
  if v_node.sponsor_id is not null then
    v_commission := round(p_amount * 0.10, 8);
    insert into public.commission_ledger(
      beneficiary_id, source_user_id, source_event_id,
      commission_type, amount, rate, leg, status, metadata
    ) values (
      v_node.sponsor_id, p_user_id, p_source_event_id,
      'direct', v_commission, 0.10, '', 'credited',
      jsonb_build_object('contract_id', p_contract_id, 'formula', 'amount * 10%')
    )
    on conflict (source_event_id, commission_type, beneficiary_id, leg) do nothing;

    if found then
      v_direct := v_commission;
    end if;
  end if;

  -- Comisión binaria: el volumen sube por la pierna del usuario y se
  -- empareja en cada ancestro que tenga parent_id y leg.
  while v_current is not null and v_step < 100 loop
    v_step := v_step + 1;

    select * into v_node
    from public.network_nodes
    where user_id = v_current;

    exit when not found or v_node.parent_id is null or v_node.leg is null;

    select * into v_parent_node
    from public.network_nodes
    where user_id = v_node.parent_id
    for update;

    exit when not found;
    v_current := v_parent_node.user_id;

    insert into public.network_volume(user_id, leg, volume, matched_volume)
    values (v_current, v_node.leg, p_amount, 0)
    on conflict (user_id, leg) do update
      set volume = public.network_volume.volume + excluded.volume,
          updated_at = now();

    -- Bloquea las dos piernas antes de calcular el nuevo emparejamiento.
    perform 1 from public.network_volume
    where user_id = v_current and leg in ('left', 'right')
    for update;

    select
      coalesce(sum(volume) filter (where leg = 'left'), 0),
      coalesce(sum(volume) filter (where leg = 'right'), 0),
      coalesce(max(matched_volume), 0)
    into v_left, v_right, v_old_matched
    from public.network_volume
    where user_id = v_current;

    v_new_matched := least(v_left, v_right);
    v_delta := greatest(v_new_matched - v_old_matched, 0);

    if v_delta > 0 then
      v_commission := round(v_delta * 0.08, 8);
      insert into public.commission_ledger(
        beneficiary_id, source_user_id, source_event_id,
        commission_type, amount, rate, leg, status, metadata
      ) values (
        v_current, p_user_id, p_source_event_id,
        'binary', v_commission, 0.08, v_node.leg, 'credited',
        jsonb_build_object(
          'contract_id', p_contract_id,
          'formula', 'new_matched_volume * 8%',
          'matched_volume', v_delta,
          'left_volume', v_left,
          'right_volume', v_right
        )
      )
      on conflict (source_event_id, commission_type, beneficiary_id, leg) do nothing;

      if found then
        v_binary := v_binary + v_commission;
      end if;
    end if;

    update public.network_volume
    set matched_volume = v_new_matched, updated_at = now()
    where user_id = v_current and leg in ('left', 'right');
  end loop;

  return jsonb_build_object(
    'status', 'processed',
    'source_event_id', p_source_event_id,
    'direct', v_direct,
    'binary', v_binary,
    'levels_processed', v_step
  );
end;
$$;

revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from public;
revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from anon;
revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from authenticated;
grant execute on function public.process_contract_commissions(text, text, uuid, numeric, text) to service_role;

-- Resumen remoto para el backend. Devuelve totales y volumen actual de las
-- piernas del usuario sin exponer el ledger de otros usuarios.
create or replace function public.get_my_commission_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_direct numeric;
  v_binary numeric;
  v_left numeric;
  v_right numeric;
  v_matched numeric;
begin
  if v_user_id is null then raise exception 'Authenticated user is required'; end if;

  select coalesce(sum(amount) filter (where commission_type = 'direct'), 0),
         coalesce(sum(amount) filter (where commission_type = 'binary'), 0)
  into v_direct, v_binary
  from public.commission_ledger
  where beneficiary_id = v_user_id and status = 'credited';

  select coalesce(sum(volume) filter (where leg = 'left'), 0),
         coalesce(sum(volume) filter (where leg = 'right'), 0),
         coalesce(max(matched_volume), 0)
  into v_left, v_right, v_matched
  from public.network_volume
  where user_id = v_user_id;

  return jsonb_build_object(
    'direct', v_direct,
    'binary', v_binary,
    'total', v_direct + v_binary,
    'binary_volume', jsonb_build_object(
      'left', v_left,
      'right', v_right,
      'matched', v_matched,
      'status', case
        when v_matched > 0 then 'paired'
        when v_left > 0 or v_right > 0 then 'awaiting_pair'
        else 'no_volume'
      end,
      'updated_at', now()
    )
  );
end;
$$;

revoke all on function public.get_my_commission_summary() from public;
revoke all on function public.get_my_commission_summary() from anon;
grant execute on function public.get_my_commission_summary() to authenticated;
