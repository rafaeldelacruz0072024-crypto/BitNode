-- Activación atómica de contrato + comisión.
-- Ejecutar después de commissions.sql en el proyecto Supabase BitNode.
-- No crea datos de prueba.

create or replace function public.activate_contract_and_commissions(
  p_user_id uuid,
  p_contract_id text,
  p_username text,
  p_label text,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_existing_status text;
  v_commission jsonb;
begin
  if p_user_id is null or nullif(trim(p_contract_id), '') is null then
    raise exception 'User and contract identifiers are required';
  end if;
  if p_amount is null or p_amount < 10 or p_amount > 100000 then
    raise exception 'Contract amount must be between 10 and 100000';
  end if;

  select status into v_existing_status
  from public.transactions
  where id = p_contract_id and user_id = p_user_id and type = 'contract'
  for update;

  if v_existing_status is not null then
    return jsonb_build_object('status', 'duplicate', 'contract_id', p_contract_id);
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.transactions
  where user_id = p_user_id and status = 'completed';

  if v_balance < p_amount then
    raise exception 'Insufficient available balance';
  end if;

  insert into public.transactions (
    id, user_id, username, type, label, amount, status, created_at
  ) values (
    p_contract_id, p_user_id, nullif(trim(p_username), ''), 'contract', p_label,
    -p_amount, 'completed', now()
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
    'commission', v_commission
  );
end;
$$;

revoke all on function public.activate_contract_and_commissions(uuid, text, text, text, numeric) from public;
grant execute on function public.activate_contract_and_commissions(uuid, text, text, text, numeric) to service_role;
