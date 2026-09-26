begin;

-- A completed finite node is its own capital entitlement. It must not consume
-- or be blocked by the user's ordinary daily withdrawal allowance.
drop index if exists public.finite_node_one_claim_per_mexico_day;
drop trigger if exists guard_user_capital_claim_block on public.finite_node_capital_choices;

create or replace function public.choose_finite_node_capital(p_user_id uuid, p_contract_id text, p_action text)
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

-- A capital claim also stops blocking an ordinary withdrawal made later that day.
do $patch$
declare
  source text := pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure);
  capital_daily_check text := '  if exists (select 1 from public.finite_node_capital_choices c where c.user_id = p_user_id and c.action = ''claim'' and c.claim_day = (now() at time zone ''America/Mexico_City'')::date) then raise exception ''Solo puedes solicitar 1 retiro por día (hora de Ciudad de México).'' using errcode = ''P0001''; end if;' || chr(10);
begin
  if position(capital_daily_check in source) > 0 then
    execute replace(source, capital_daily_check, '');
  end if;
  if position('finite_node_capital_choices' in pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure)) > 0 then
    raise exception 'Capital claim is still coupled to the withdrawal validator; review before applying.';
  end if;
end;
$patch$;

notify pgrst, 'reload schema';
commit;
