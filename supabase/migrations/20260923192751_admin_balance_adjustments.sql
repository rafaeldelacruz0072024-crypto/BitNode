create or replace function public.admin_adjust_balance(
  p_user_id uuid, p_amount numeric, p_reason text, p_request_id uuid, p_admin_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_username text;
  v_id text := 'ADMIN-ADJUST-' || p_request_id::text;
  v_existing public.transactions%rowtype;
  v_balance numeric;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_user_id is null or p_admin_id is null or p_request_id is null then raise exception 'Missing identifier'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid amount';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'Operator is not an admin';
  end if;

  perform 1 from public.profiles where id = p_user_id for no key update;
  if not found then raise exception 'Target profile not found'; end if;
  select username into v_username from public.profiles where id = p_user_id;
  perform pg_advisory_xact_lock(hashtextextended(v_id, 0));
  select * into v_existing from public.transactions where id = v_id;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.amount <> p_amount or v_existing.type <> 'deposit'
      or v_existing.provider_status <> 'admin_adjustment:' || p_admin_id::text then
      raise exception 'Request id already used for a different adjustment';
    end if;
    return jsonb_build_object('id', v_id, 'status', 'duplicate', 'amount', v_existing.amount,
      'balance', (public.get_account_ledger_summary(p_user_id)->>'balance')::numeric);
  end if;

  select (public.get_account_ledger_summary(p_user_id)->>'balance')::numeric into v_balance;
  if p_amount < 0 and v_balance + p_amount < 0 then
    raise exception 'Saldo disponible insuficiente para realizar el débito' using errcode = 'P0001';
  end if;
  insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
  values(v_id,p_user_id,v_username,'deposit',
    left(case when p_amount > 0 then 'Crédito administrativo · ' else 'Débito administrativo · ' end
      || coalesce(nullif(trim(p_reason), ''), 'Ajuste manual'),160),
    p_amount,'completed','admin_adjustment:' || p_admin_id::text);
  return jsonb_build_object('id',v_id,'status','completed','amount',p_amount,
    'balance',(public.get_account_ledger_summary(p_user_id)->>'balance')::numeric);
end;
$$;
revoke all on function public.admin_adjust_balance(uuid,numeric,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.admin_adjust_balance(uuid,numeric,text,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
