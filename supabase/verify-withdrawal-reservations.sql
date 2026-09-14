-- Run after the migration in BitNode. All test writes are rolled back.
begin;
do $$
declare
  v_user uuid; v_id uuid; v_other uuid; v_result jsonb; v_before numeric; v_used numeric;
  v_total bigint; v_blocked boolean; v_window jsonb;
begin
  select id into v_user from public.profiles order by id limit 1;
  if v_user is null then raise exception 'Verification requires an existing profile'; end if;
  select count(*) into v_total from public.transactions;
  select value into v_window from public.platform_settings where key='withdrawal_window';
  v_before := (public.get_account_ledger_summary(v_user)->>'balance')::numeric;
  select coalesce(sum(abs(amount)),0) into v_used from public.transactions where user_id=v_user and type='withdraw'
    and created_at >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC');
  if v_used > 900 then raise exception 'Choose a profile with unused daily withdrawal capacity'; end if;

  insert into public.transactions(id,user_id,type,label,amount,status)
    values('VERIFY-DEPOSIT-'||gen_random_uuid(),v_user,'deposit','Rollback-only verification',2000,'completed');
  insert into public.email_security_challenges(user_id,purpose,code_hash,payload,expires_at)
    values(v_user,'withdrawal','rollback-test-hash',jsonb_build_object('amount',60,'network','BNB Chain','wallet','0x0000000000000000000000000000000000000001'),now()+interval '10 minutes') returning id into v_id;
  update public.platform_settings set value=jsonb_build_object('enabled',false) where key='withdrawal_window';
  v_blocked := false;
  begin
    perform public.confirm_verified_withdrawal(v_user,v_id,'rollback-test-hash');
  exception when raise_exception then
    if sqlerrm not like '%ventana%' then raise; end if;
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Closed window was bypassed'; end if;
  if exists(select 1 from public.email_security_challenges where id=v_id and consumed_at is not null) then
    raise exception 'Rejected reservation consumed the code';
  end if;
  update public.platform_settings set value=jsonb_build_object('enabled',true) where key='withdrawal_window';
  v_result := public.confirm_verified_withdrawal(v_user,v_id,'rollback-test-hash');
  if (v_result->>'fee')::numeric<>3 or (v_result->>'netAmount')::numeric<>57 then raise exception 'Fee mismatch'; end if;
  if (public.get_account_ledger_summary(v_user)->>'balance')::numeric<>v_before+1940 then raise exception 'Missing reservation'; end if;
  perform public.confirm_verified_withdrawal(v_user,v_id,'rollback-test-hash');
  if (select count(*) from public.transactions where email_challenge_id=v_id)<>1 then raise exception 'Replay duplicated withdrawal'; end if;
  update public.transactions set status='approved' where email_challenge_id=v_id;
  if (public.get_account_ledger_summary(v_user)->>'balance')::numeric<>v_before+1940 then raise exception 'Approval changed reservation'; end if;
  update public.transactions set status='completed' where email_challenge_id=v_id;
  if (public.get_account_ledger_summary(v_user)->>'balance')::numeric<>v_before+1940 then raise exception 'Double debit on payment'; end if;

  insert into public.email_security_challenges(user_id,purpose,code_hash,payload,expires_at)
    values(v_user,'withdrawal','rollback-test-hash',jsonb_build_object('amount',10,'network','BNB Chain','wallet','0x0000000000000000000000000000000000000001'),now()+interval '10 minutes') returning id into v_other;
  perform public.confirm_verified_withdrawal(v_user,v_other,'rollback-test-hash');
  update public.transactions set status='approved' where email_challenge_id=v_other;
  update public.transactions set status='rejected' where email_challenge_id=v_other;
  if (public.get_account_ledger_summary(v_user)->>'balance')::numeric<>v_before+1940 then raise exception 'Rejection did not release reservation'; end if;

  v_blocked := false;
  begin
    insert into public.transactions(id,user_id,type,label,amount,status)
      values('VERIFY-OVERSPEND-'||gen_random_uuid(),v_user,'contract','Rollback-only overspend',-(v_before+1941),'completed');
  exception when raise_exception then
    if sqlerrm not like '%Saldo%' then raise; end if;
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Node activation spent reserved funds'; end if;

  -- Reduce spendable funds to 5 USDT; a new 10 USDT reservation must fail.
  insert into public.transactions(id,user_id,type,label,amount,status)
    values('VERIFY-SPEND-'||gen_random_uuid(),v_user,'contract','Rollback-only spending',-(v_before+1935),'completed');
  insert into public.email_security_challenges(user_id,purpose,code_hash,payload,expires_at)
    values(v_user,'withdrawal','rollback-test-hash',jsonb_build_object('amount',10,'network','BNB Chain','wallet','0x0000000000000000000000000000000000000001'),now()+interval '10 minutes') returning id into v_other;
  v_blocked := false;
  begin
    perform public.confirm_verified_withdrawal(v_user,v_other,'rollback-test-hash');
  exception when raise_exception then
    if sqlerrm not like '%Saldo%' then raise; end if;
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Insufficient balance was accepted'; end if;
  if has_function_privilege('authenticated','public.confirm_verified_withdrawal(uuid,uuid,text)','EXECUTE')
    or has_table_privilege('authenticated','public.transactions','INSERT')
    or has_table_privilege('authenticated','public.transactions','UPDATE') then
    raise exception 'Client can bypass server authorization';
  end if;
end;
$$;
rollback;
select 'PASS: window, balance, reservation, approval, payment, rejection, replay and node-spend protection; test writes rolled back' as withdrawal_verification;
