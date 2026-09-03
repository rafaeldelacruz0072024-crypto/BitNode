-- Retiro del capital del Nodo Diario.
-- Solo permite cerrar el nodo después de validar las 4 tareas de la jornada
-- actual. Los rendimientos ya acreditados permanecen en el balance y no se
-- vuelven a pagar en esta operación.
create or replace function public.withdraw_daily_node_capital(p_contract_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_contract public.contracts%rowtype;
  v_plan public.plans%rowtype;
  v_cycle public.daily_task_cycles%rowtype;
  v_username text;
  v_transaction_id text;
begin
  if v_user_id is null then
    raise exception 'Authenticated user is required';
  end if;

  select * into v_contract
  from public.contracts
  where id = trim(p_contract_id) and user_id = v_user_id
  for update;
  if not found then raise exception 'Nodo no encontrado'; end if;

  select * into v_plan from public.plans where id = v_contract.plan_id and active;
  if not found or v_plan.duration_days is not null then
    raise exception 'Este nodo no permite retiro anticipado de capital';
  end if;
  if v_contract.status <> 'active' then
    raise exception 'El Nodo Diario ya fue cerrado';
  end if;

  select * into v_cycle from public.daily_task_cycles where user_id = v_user_id;
  if not found or cardinality(coalesce(v_cycle.completed_tasks, array[]::text[])) < 4
     or v_cycle.last_completed_at is null
     or v_cycle.last_completed_at < now() - interval '24 hours' then
    raise exception 'Completa consecutivamente las 4 tareas antes de retirar el capital';
  end if;

  select username into v_username from public.profiles where id = v_user_id;
  v_transaction_id := 'DAILY-CAPITAL-' || v_contract.id;

  insert into public.transactions(id, user_id, username, type, label, amount, status, created_at)
  values (v_transaction_id, v_user_id, v_username, 'deposit',
          'Capital retirado - ' || v_plan.name, v_contract.amount, 'completed', now())
  on conflict (id) do nothing;

  update public.contracts
  set status = 'completed', principal_returned_at = coalesce(principal_returned_at, now()), ends_at = now()
  where id = v_contract.id and user_id = v_user_id and status = 'active';

  return jsonb_build_object(
    'status', 'capital_withdrawn',
    'contract_id', v_contract.id,
    'plan_name', v_plan.name,
    'capital_returned', v_contract.amount,
    'transaction_id', v_transaction_id
  );
end;
$$;

revoke all on function public.withdraw_daily_node_capital(text) from public, anon;
grant execute on function public.withdraw_daily_node_capital(text) to authenticated;
