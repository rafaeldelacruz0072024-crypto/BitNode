-- BitNode: activación de plan y creación de posición de nodo.
-- Requisitos: ejecutar primero core-model.sql y commissions.sql.
-- Ejecutar este archivo después de ambos archivos.
-- La función debe ser invocada por el backend usando service_role.
-- No inserta datos de prueba ni elimina tablas o registros.

create or replace function public.activate_plan_and_node(
  p_user_id uuid,
  p_contract_id text,
  p_plan_id text,
  p_amount numeric,
  p_parent_id uuid default null,
  p_leg text default null,
  p_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.plans%rowtype;
  v_profile public.profiles%rowtype;
  v_node public.network_nodes%rowtype;
  v_parent public.network_nodes%rowtype;
  v_existing_contract public.contracts%rowtype;
  v_balance numeric;
  v_ends_at timestamptz;
  v_commission jsonb;
  v_sponsor_id uuid;
  v_node_created boolean := false;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;
  if nullif(trim(p_contract_id), '') is null then
    raise exception 'Contract id is required';
  end if;
  if nullif(trim(p_plan_id), '') is null then
    raise exception 'Plan id is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_leg is not null and p_leg not in ('left', 'right') then
    raise exception 'Leg must be left or right';
  end if;
  if (p_parent_id is null and p_leg is not null) or (p_parent_id is not null and p_leg is null) then
    raise exception 'Parent and leg must be provided together';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;
  if not found then
    raise exception 'User profile not found';
  end if;
  v_sponsor_id := v_profile.sponsor_id;

  select * into v_plan
  from public.plans
  where id = p_plan_id and active = true
  for update;
  if not found then
    raise exception 'Active plan not found';
  end if;
  if p_amount < v_plan.min_amount then
    raise exception 'Amount is below the plan minimum of %', v_plan.min_amount;
  end if;

  select * into v_existing_contract
  from public.contracts
  where id = p_contract_id and user_id = p_user_id
  for update;
  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'contract_id', p_contract_id,
      'plan_id', v_existing_contract.plan_id,
      'node_created', false
    );
  end if;

  if p_parent_id is not null then
    if p_parent_id = p_user_id then
      raise exception 'A node cannot be its own parent';
    end if;
    select * into v_parent
    from public.network_nodes
    where user_id = p_parent_id
    for update;
    if not found then
      raise exception 'Binary parent node not found';
    end if;
  end if;

  select * into v_node
  from public.network_nodes
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.network_nodes(user_id, sponsor_id, parent_id, leg)
    values (p_user_id, v_sponsor_id, p_parent_id, p_leg)
    returning * into v_node;
    v_node_created := true;
  else
    if v_node.sponsor_id is distinct from v_sponsor_id then
      raise exception 'Existing node sponsor does not match profile sponsor';
    end if;
    if p_parent_id is not null and (v_node.parent_id is distinct from p_parent_id or v_node.leg is distinct from p_leg) then
      raise exception 'Existing node placement cannot be changed during activation';
    end if;
  end if;

  select coalesce(sum(amount), 0)
  into v_balance
  from public.transactions
  where user_id = p_user_id and status = 'completed';

  if v_balance < p_amount then
    raise exception 'Insufficient available balance';
  end if;

  if v_plan.duration_days is not null then
    v_ends_at := now() + make_interval(days => v_plan.duration_days);
  end if;

  insert into public.contracts(
    id, user_id, plan_id, amount, status, starts_at, ends_at
  ) values (
    p_contract_id, p_user_id, p_plan_id, p_amount, 'active', now(), v_ends_at
  );

  insert into public.transactions(
    id, user_id, username, type, label, amount, status, created_at
  ) values (
    p_contract_id,
    p_user_id,
    nullif(trim(coalesce(p_username, v_profile.username)), ''),
    'contract',
    v_plan.name,
    -p_amount,
    'completed',
    now()
  );

  v_commission := public.process_contract_commissions(
    'contract:' || p_contract_id || ':confirmed',
    p_contract_id,
    p_user_id,
    p_amount,
    'contract_confirmed'
  );

  return jsonb_build_object(
    'status', 'activated',
    'contract_id', p_contract_id,
    'plan_id', p_plan_id,
    'plan_name', v_plan.name,
    'node_created', v_node_created,
    'parent_id', v_node.parent_id,
    'leg', v_node.leg,
    'starts_at', now(),
    'ends_at', v_ends_at,
    'commission', v_commission
  );
exception
  when unique_violation then
    raise exception 'Activation conflicts with an existing contract or binary position';
end;
$$;

revoke all on function public.activate_plan_and_node(uuid, text, text, numeric, uuid, text, text) from public;
revoke all on function public.activate_plan_and_node(uuid, text, text, numeric, uuid, text, text) from anon;
revoke all on function public.activate_plan_and_node(uuid, text, text, numeric, uuid, text, text) from authenticated;
grant execute on function public.activate_plan_and_node(uuid, text, text, numeric, uuid, text, text) to service_role;

-- Verificación de solo lectura opcional:
-- select id, name, slug, min_amount, duration_days, active from public.plans order by min_amount, id;
-- select id, user_id, plan_id, amount, status, starts_at, ends_at from public.contracts order by created_at desc limit 20;
-- select user_id, sponsor_id, parent_id, leg from public.network_nodes order by created_at desc limit 20;
