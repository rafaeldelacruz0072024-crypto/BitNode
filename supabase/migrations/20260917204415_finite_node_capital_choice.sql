begin;

create table public.finite_node_capital_choices (
  contract_id text primary key references public.contracts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('claim','reinvest')),
  status text not null check (status in ('pending','approved','completed','rejected','reinvested')),
  amount numeric(18,2) not null check (amount > 0),
  fee numeric(18,2) not null default 0 check (fee >= 0),
  net_amount numeric(18,2) not null check (net_amount > 0),
  wallet text,
  requested_at timestamptz not null default now(),
  claim_day date,
  payable_at timestamptz,
  resolved_at timestamptz,
  reference text,
  new_contract_id text unique references public.contracts(id) on delete restrict,
  constraint finite_node_choice_shape check (
    (action = 'claim' and status in ('pending','approved','completed','rejected') and payable_at is not null and wallet is not null and claim_day is not null and new_contract_id is null)
    or (action = 'reinvest' and status = 'reinvested' and new_contract_id is not null and payable_at is null and claim_day is null)
  )
);
create index finite_node_claim_queue on public.finite_node_capital_choices(status, payable_at) where action = 'claim';
create unique index finite_node_one_claim_per_mexico_day
  on public.finite_node_capital_choices(user_id, claim_day)
  where action = 'claim';
alter table public.finite_node_capital_choices enable row level security;
revoke all on public.finite_node_capital_choices from public, anon, authenticated;
grant select, insert, update on public.finite_node_capital_choices to service_role;

create function public.choose_finite_node_capital(p_user_id uuid, p_contract_id text, p_action text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_contract public.contracts%rowtype;
  v_plan public.plans%rowtype;
  v_username text;
  v_wallet text;
  v_available jsonb;
  v_amount numeric(18,2);
  v_fee numeric(18,2);
  v_new_id text;
begin
  if p_action not in ('claim','reinvest') or p_contract_id is null or p_user_id is null then
    raise exception 'Elección de capital inválida.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = p_user_id for no key update;
  if not found then raise exception 'Perfil no encontrado.' using errcode = 'P0001'; end if;
  select * into v_contract from public.contracts where id = p_contract_id and user_id = p_user_id for update;
  if not found or v_contract.status <> 'completed' or v_contract.principal_returned_at is null then
    raise exception 'El nodo aún no ha concluido su ciclo.' using errcode = 'P0001';
  end if;
  select * into v_plan from public.plans where id = v_contract.plan_id;
  if not found or not coalesce(v_plan.duration_days in (7,14,21), false) or not coalesce(v_plan.principal_returned, false) then
    raise exception 'Este nodo no permite elegir el destino del capital.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.finite_node_capital_choices where contract_id = p_contract_id) then
    raise exception 'El capital de este nodo ya fue asignado.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.transactions where id = 'PRINCIPAL-' || p_contract_id
      and user_id = p_user_id and status = 'completed' and amount = v_contract.amount) then
    raise exception 'El capital del nodo aún no está acreditado.' using errcode = 'P0001';
  end if;
  if v_contract.amount <> round(v_contract.amount, 2) then
    raise exception 'El capital debe tener hasta dos decimales.' using errcode = 'P0001';
  end if;
  v_amount := v_contract.amount;
  v_available := public.get_withdrawal_availability(p_user_id, now());
  if (v_available->>'unrestricted')::numeric < v_amount then
    raise exception 'El capital disponible no alcanza para esta elección.' using errcode = 'P0001';
  end if;
  select username into v_username from public.profiles where id = p_user_id;
  if p_action = 'claim' then
    if exists (select 1 from public.transactions where user_id = p_user_id and type = 'withdraw'
      and withdrawal_day = (now() at time zone 'America/Mexico_City')::date) then
      raise exception 'Solo puedes solicitar 1 retiro por día (hora de Ciudad de México).' using errcode = 'P0001';
    end if;
    select raw_app_meta_data->>'withdrawal_wallet_bep20' into v_wallet from auth.users where id = p_user_id;
    if v_wallet is null or v_wallet !~ '^0x[a-fA-F0-9]{40}$' then
      raise exception 'Guarda y verifica tu wallet BEP20 en Perfil antes de reclamar.' using errcode = 'P0001';
    end if;
    v_fee := round(greatest(1, v_amount * 0.05), 2);
    if v_amount <= v_fee then raise exception 'El capital no cubre la comisión de retiro.' using errcode = 'P0001'; end if;
    insert into public.finite_node_capital_choices(contract_id,user_id,action,status,amount,fee,net_amount,wallet,payable_at,claim_day)
    values (p_contract_id,p_user_id,'claim','pending',v_amount,v_fee,v_amount-v_fee,v_wallet,now()+interval '24 hours',
      (now() at time zone 'America/Mexico_City')::date);
    insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
    values ('CAPITAL-RESERVE-' || p_contract_id,p_user_id,v_username,'deposit',
      'Capital reservado para retiro - ' || v_plan.name,-v_amount,'completed','finite_capital_reservation');
    return jsonb_build_object('status','pending','contract_id',p_contract_id,'payable_at',
      (select payable_at from public.finite_node_capital_choices where contract_id = p_contract_id));
  end if;
  if not v_plan.active then raise exception 'Este plan ya no admite reinversiones.' using errcode = 'P0001'; end if;
  v_new_id := 'REINVEST-' || p_contract_id;
  insert into public.contracts(id,user_id,plan_id,amount,status,starts_at,ends_at)
  values (v_new_id,p_user_id,v_plan.id,v_amount,'active',now(),now()+make_interval(days => v_plan.duration_days));
  insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
  values (v_new_id,p_user_id,v_username,'contract','Reinversión - ' || v_plan.name,-v_amount,'completed','finite_capital_reinvested');
  insert into public.finite_node_capital_choices(contract_id,user_id,action,status,amount,net_amount,new_contract_id)
  values (p_contract_id,p_user_id,'reinvest','reinvested',v_amount,v_amount,v_new_id);
  return jsonb_build_object('status','reinvested','contract_id',p_contract_id,'new_contract_id',v_new_id);
end;
$$;
revoke all on function public.choose_finite_node_capital(uuid,text,text) from public,anon,authenticated;
grant execute on function public.choose_finite_node_capital(uuid,text,text) to service_role;

create function public.manage_finite_node_claim(p_contract_id text, p_action text, p_admin_id uuid, p_reference text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_claim public.finite_node_capital_choices%rowtype; v_role text; v_next text;
begin
  select role into v_role from public.profiles where id = p_admin_id;
  if v_role is distinct from 'admin' then raise exception 'Administrador no autorizado.' using errcode = 'P0001'; end if;
  select * into v_claim from public.finite_node_capital_choices where contract_id = p_contract_id and action = 'claim' for update;
  if not found then raise exception 'Reclamo no encontrado.' using errcode = 'P0001'; end if;
  if p_action = 'approve' and v_claim.status = 'pending' then v_next := 'approved';
  elsif p_action = 'mark_paid' and v_claim.status = 'approved' then
    if now() < v_claim.payable_at then raise exception 'Espera 24 horas desde la solicitud antes de marcar el pago.' using errcode = 'P0001'; end if;
    if nullif(trim(p_reference),'') is null then raise exception 'Indica el TXID o referencia del pago.' using errcode = 'P0001'; end if;
    v_next := 'completed';
  elsif p_action = 'reject' and v_claim.status in ('pending','approved') then v_next := 'rejected';
  else raise exception 'Transición de reclamo no válida.' using errcode = 'P0001'; end if;
  if v_next = 'rejected' then
    insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
    values ('CAPITAL-REFUND-' || p_contract_id,v_claim.user_id,
      (select username from public.profiles where id = v_claim.user_id),'deposit',
      'Capital liberado tras rechazo - ' || p_contract_id,v_claim.amount,'completed','finite_capital_refund');
  end if;
  update public.finite_node_capital_choices set status = v_next,
    reference = nullif(left(trim(p_reference),120),''),
    resolved_at = case when v_next in ('completed','rejected') then now() else null end
  where contract_id = p_contract_id;
  return jsonb_build_object('contract_id',p_contract_id,'status',v_next);
end;
$$;
revoke all on function public.manage_finite_node_claim(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.manage_finite_node_claim(text,text,uuid,text) to service_role;

-- A capital claim consumes the same Mexico City day as any other withdrawal.
do $patch$
declare v_old text := pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure);
  v_pattern text := 'select[[:space:]]+value[[:space:]]+into[[:space:]]+v_window[[:space:]]+from[[:space:]]+public[.]platform_settings[[:space:]]+where[[:space:]]+key[[:space:]]*=[[:space:]]*''withdrawal_window'';';
  v_marker text;
begin
  v_marker := substring(v_old from v_pattern);
  if v_marker is null or position('public.finite_node_capital_choices' in v_old) > 0 then
    raise exception 'Unexpected withdrawal validator. Review before applying capital-choice rule.';
  end if;
  execute replace(v_old,v_marker,
    '  if exists (select 1 from public.finite_node_capital_choices c where c.user_id = p_user_id and c.action = ''claim'' and c.claim_day = (now() at time zone ''America/Mexico_City'')::date) then raise exception ''Solo puedes solicitar 1 retiro por día (hora de Ciudad de México).'' using errcode = ''P0001''; end if;' || chr(10) || v_marker);
end;
$patch$;

notify pgrst, 'reload schema';
commit;
