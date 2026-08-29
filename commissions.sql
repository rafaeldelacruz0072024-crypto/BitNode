create table if not exists public.network_nodes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sponsor_id uuid references auth.users(id) on delete restrict,
  parent_id uuid references auth.users(id) on delete restrict,
  leg text check (leg in ('left', 'right')),
  created_at timestamptz not null default now(),
  constraint network_nodes_parent_leg_unique unique (parent_id, leg),
  constraint network_nodes_leg_parent_check check ((parent_id is null and leg is null) or (parent_id is not null and leg is not null)),
  constraint network_nodes_not_self_sponsor check (sponsor_id is null or sponsor_id <> user_id),
  constraint network_nodes_not_self_parent check (parent_id is null or parent_id <> user_id)
);

create index if not exists network_nodes_sponsor_idx on public.network_nodes(sponsor_id);
create index if not exists network_nodes_parent_idx on public.network_nodes(parent_id);

create table if not exists public.commission_events (
  source_event_id text primary key,
  contract_id text not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  amount numeric(18,8) not null check (amount > 0),
  event_type text not null check (event_type in ('contract_confirmed', 'contract_reversed')),
  created_at timestamptz not null default now()
);

create index if not exists commission_events_contract_idx on public.commission_events(contract_id);
create index if not exists commission_events_user_idx on public.commission_events(user_id);

create table if not exists public.network_volume (
  user_id uuid not null references auth.users(id) on delete cascade,
  leg text not null check (leg in ('left', 'right')),
  volume numeric(18,8) not null default 0 check (volume >= 0),
  matched_volume numeric(18,8) not null default 0 check (matched_volume >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, leg),
  constraint network_volume_matched_not_above_volume check (matched_volume >= 0)
);

create index if not exists network_volume_user_idx on public.network_volume(user_id);

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

create index if not exists commission_ledger_beneficiary_idx on public.commission_ledger(beneficiary_id, created_at desc);
create index if not exists commission_ledger_source_event_idx on public.commission_ledger(source_event_id);

alter table public.network_nodes enable row level security;
alter table public.commission_events enable row level security;
alter table public.network_volume enable row level security;
alter table public.commission_ledger enable row level security;

drop policy if exists network_nodes_select_own on public.network_nodes;
create policy network_nodes_select_own on public.network_nodes for select to authenticated using (user_id = auth.uid() or sponsor_id = auth.uid() or parent_id = auth.uid());

drop policy if exists network_volume_select_own on public.network_volume;
create policy network_volume_select_own on public.network_volume for select to authenticated using (user_id = auth.uid());

drop policy if exists commission_ledger_select_own on public.commission_ledger;
create policy commission_ledger_select_own on public.commission_ledger for select to authenticated using (beneficiary_id = auth.uid());

drop policy if exists commission_events_select_own on public.commission_events;
create policy commission_events_select_own on public.commission_events for select to authenticated using (user_id = auth.uid());

create or replace function public.process_contract_commissions(
  p_source_event_id text,
  p_contract_id text,
  p_user_id uuid,
  p_amount numeric,
  p_event_type text default 'contract_confirmed'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_node public.network_nodes%rowtype;
  v_parent public.network_nodes%rowtype;
  v_direct numeric := 0;
  v_binary numeric := 0;
  v_left numeric;
  v_right numeric;
  v_old_matched numeric;
  v_new_matched numeric;
  v_delta numeric;
  v_step integer := 0;
  v_current uuid := p_user_id;
  v_event_amount numeric := p_amount;
  v_commission numeric;
begin
  if p_source_event_id is null or length(trim(p_source_event_id)) = 0 then raise exception 'source event id is required'; end if;
  if p_contract_id is null or length(trim(p_contract_id)) = 0 then raise exception 'contract id is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_event_type not in ('contract_confirmed', 'contract_reversed') then raise exception 'unsupported event type'; end if;

  insert into public.commission_events(source_event_id, contract_id, user_id, amount, event_type)
  values (p_source_event_id, p_contract_id, p_user_id, p_amount, p_event_type)
  on conflict (source_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('status', 'duplicate', 'source_event_id', p_source_event_id, 'direct', 0, 'binary', 0);
  end if;

  if p_event_type = 'contract_reversed' then
    raise exception 'reversals require an explicit compensating event implementation';
  end if;

  select * into v_node from public.network_nodes where user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'processed', 'source_event_id', p_source_event_id, 'direct', 0, 'binary', 0, 'reason', 'user has no network node');
  end if;

  if v_node.sponsor_id is not null then
    v_commission := round(p_amount * 0.10, 8);
    insert into public.commission_ledger(beneficiary_id, source_user_id, source_event_id, commission_type, amount, rate, leg, status, metadata)
    values (v_node.sponsor_id, p_user_id, p_source_event_id, 'direct', v_commission, 0.10, '', 'credited', jsonb_build_object('contract_id', p_contract_id))
    on conflict (source_event_id, commission_type, beneficiary_id, leg) do nothing;
    if found then v_direct := v_commission; end if;
  end if;

  while v_current is not null and v_step < 100 loop
    v_step := v_step + 1;
    select * into v_node from public.network_nodes where user_id = v_current;
    exit when not found or v_node.parent_id is null or v_node.leg is null;
    v_current := v_node.parent_id;

    insert into public.network_volume(user_id, leg, volume, matched_volume)
    values (v_current, v_node.leg, v_event_amount, 0)
    on conflict (user_id, leg) do update set volume = public.network_volume.volume + excluded.volume, updated_at = now();

    select coalesce(sum(volume) filter (where leg = 'left'), 0), coalesce(sum(volume) filter (where leg = 'right'), 0)
      into v_left, v_right from public.network_volume where user_id = v_current;
    select coalesce(max(matched_volume), 0) into v_old_matched from public.network_volume where user_id = v_current;
    v_new_matched := least(v_left, v_right);
    v_delta := greatest(v_new_matched - v_old_matched, 0);

    if v_delta > 0 then
      v_commission := round(v_delta * 0.08, 8);
      insert into public.commission_ledger(beneficiary_id, source_user_id, source_event_id, commission_type, amount, rate, leg, status, metadata)
    values (v_current, p_user_id, p_source_event_id, 'binary', v_commission, 0.08, v_node.leg, 'credited', jsonb_build_object('contract_id', p_contract_id, 'matched_volume', v_delta, 'left_volume', v_left, 'right_volume', v_right))
      on conflict (source_event_id, commission_type, beneficiary_id, leg) do nothing;
      if found then v_binary := v_binary + v_commission; end if;
    end if;

    update public.network_volume set matched_volume = v_new_matched, updated_at = now() where user_id = v_current and leg in ('left', 'right');
  end loop;

  return jsonb_build_object('status', 'processed', 'source_event_id', p_source_event_id, 'direct', v_direct, 'binary', v_binary);
end;
$$;

revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from public;
grant execute on function public.process_contract_commissions(text, text, uuid, numeric, text) to service_role;
