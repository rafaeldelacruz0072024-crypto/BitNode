create function public.admin_release_active_node_capital(
  p_admin_id uuid, p_contract_id text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_contract public.contracts%rowtype;
  v_username text;
  v_transaction_id text;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'Administrador requerido.';
  end if;
  if coalesce(length(trim(p_reason)), 0) not between 5 and 500 then
    raise exception 'Escribe un motivo de 5 a 500 caracteres.';
  end if;

  select p.username into v_username
  from public.profiles p join public.contracts c on c.user_id = p.id
  where c.id = p_contract_id
  for no key update of p;

  select * into v_contract from public.contracts where id = p_contract_id for update;
  if not found or v_username is null or v_contract.status <> 'active'
     or v_contract.principal_returned_at is not null then
    raise exception 'El nodo ya no tiene capital activo para liberar.';
  end if;
  if v_contract.amount <> round(v_contract.amount, 2) then
    raise exception 'El capital del nodo requiere conciliación antes de liberarse.';
  end if;

  v_transaction_id := case when v_contract.plan_id = 'daily'
    then 'DAILY-CAPITAL-' else 'PRINCIPAL-' end || v_contract.id;
  if exists (
    select 1 from public.transactions
    where id in ('DAILY-CAPITAL-' || v_contract.id, 'PRINCIPAL-' || v_contract.id)
  ) then
    raise exception 'Ya existe un movimiento de devolución para este nodo.';
  end if;

  insert into public.transactions (id, user_id, username, type, label, amount, status, provider_status)
  values (v_transaction_id, v_contract.user_id, v_username, 'deposit',
    'Capital liberado por administración', v_contract.amount, 'completed', 'admin_node_capital_release');

  -- Close earned rewards using the same settlement as the normal finite cycle.
  update public.transactions t set status = 'completed'
  from public.contract_cycle_rewards r
  where r.contract_id = v_contract.id and r.user_id = v_contract.user_id
    and r.status = 'pending' and r.transaction_id = t.id
    and t.user_id = v_contract.user_id and t.type = 'yield' and t.status = 'pending';

  update public.contract_cycle_rewards r set status = 'completed', updated_at = now()
  where r.contract_id = v_contract.id and r.user_id = v_contract.user_id and r.status = 'pending'
    and exists (
      select 1 from public.transactions t where t.id = r.transaction_id
      and t.user_id = r.user_id and t.type = 'yield' and t.status = 'completed'
    );

  update public.contracts
  set status = 'completed', principal_returned_at = now(), ends_at = now()
  where id = v_contract.id;

  insert into public.admin_operation_audit_log (admin_id, admin_username, action, target_type, target_id, details)
  select p_admin_id, username, 'node_capital_release', 'contract', v_contract.id,
    jsonb_build_object('user_id', v_contract.user_id, 'username', v_username,
      'amount', v_contract.amount, 'reason', trim(p_reason), 'transaction_id', v_transaction_id)
  from public.profiles where id = p_admin_id;

  return jsonb_build_object('amount', v_contract.amount, 'transactionId', v_transaction_id);
end;
$$;

revoke all on function public.admin_release_active_node_capital(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_release_active_node_capital(uuid, text, text) to service_role;
notify pgrst, 'reload schema';
