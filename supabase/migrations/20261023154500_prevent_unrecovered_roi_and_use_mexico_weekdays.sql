begin;

-- Forward-only protection. Historical residuals are intentionally not loaded
-- here because doing so would change user balances without a separate review.
create table if not exists bitnode_private.roi_recovery_debts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  outstanding numeric not null default 0 check (outstanding >= 0),
  accrued_total numeric not null default 0 check (accrued_total >= 0),
  recovered_total numeric not null default 0 check (recovered_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recovered_total <= accrued_total)
);
revoke all on table bitnode_private.roi_recovery_debts from public, anon, authenticated;
grant select on table bitnode_private.roi_recovery_debts to service_role;

create or replace function public.reset_daily_cycle_for_user(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reward record;
  v_balance numeric;
  v_debit numeric;
  v_unrecovered numeric;
begin
  perform 1 from public.daily_task_cycles where user_id = p_user_id for update;
  if not found then return; end if;
  perform 1 from public.profiles where id = p_user_id for no key update;
  if p_reason = 'missed_24h_window' then
    insert into public.user_notifications(user_id, kind)
    select p_user_id, 'cycle_reset' from public.daily_task_cycles
    where user_id = p_user_id and (cycle_day > 0 or cardinality(completed_tasks) > 0
      or window_started_at is not null or last_completed_at is not null);

    select greatest(coalesce(sum(amount), 0), 0) into v_balance
    from public.transactions where user_id = p_user_id
      and (status = 'completed' or (type = 'withdraw' and status in ('pending','approved')));

    for v_reward in
      select r.id, t.id as transaction_id, t.amount, t.status
      from public.contract_cycle_rewards r
      join public.contracts c on c.id = r.contract_id and c.user_id = r.user_id
      join public.transactions t on t.id = r.transaction_id and t.user_id = r.user_id
      where r.user_id = p_user_id and c.status = 'active'
        and r.status in ('pending','completed') and t.type = 'yield' and t.amount > 0
        and t.status in ('pending','completed')
      order by r.created_at, r.id for update of r, t
    loop
      if v_reward.status = 'pending' then
        update public.transactions set status = 'reversed' where id = v_reward.transaction_id;
      else
        v_debit := least(v_balance, v_reward.amount);
        if v_debit > 0 then
          insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
          select 'YIELD-RESET-' || v_reward.id::text, p_user_id, username, 'yield',
            'Descuento por reinicio de nodo · tareas incumplidas', -v_debit, 'completed',
            'cycle_reset:' || v_reward.transaction_id
          from public.profiles where id = p_user_id
          on conflict (id) do nothing;
          if found then v_balance := v_balance - v_debit; end if;
        end if;

        v_unrecovered := greatest(v_reward.amount - v_debit, 0);
        if v_unrecovered > 0 then
          insert into bitnode_private.roi_recovery_debts(user_id,outstanding,accrued_total)
          values (p_user_id,v_unrecovered,v_unrecovered)
          on conflict (user_id) do update set
            outstanding = bitnode_private.roi_recovery_debts.outstanding + excluded.outstanding,
            accrued_total = bitnode_private.roi_recovery_debts.accrued_total + excluded.accrued_total,
            updated_at = now();
        end if;
      end if;
      update public.contract_cycle_rewards set status = 'reversed', updated_at = now()
      where id = v_reward.id;
    end loop;
  end if;
  update public.contract_cycle_rewards r set status = 'reversed', updated_at = now()
  from public.contracts c where r.user_id = p_user_id and c.id = r.contract_id
    and c.user_id = p_user_id and c.status = 'active' and r.status = 'pending';
  update public.daily_task_cycles set cycle_day = 0, completed_tasks = array[]::text[],
    window_started_at = null, deadline_at = null, last_task_at = now(),
    last_completed_at = null, updated_at = now() where user_id = p_user_id;
end;
$$;
revoke all on function public.reset_daily_cycle_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.reset_daily_cycle_for_user(uuid,text) to service_role;

-- Every future node ROI credit first settles any outstanding reset debt. Direct
-- and binary commissions are deliberately excluded (their ids start COMMISSION-).
create or replace function bitnode_private.recover_roi_reset_debt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_outstanding numeric;
  v_recovery numeric;
begin
  if new.status <> 'completed' or new.amount <= 0 or new.type <> 'yield'
     or new.id not like 'YIELD-%'
     or new.id like 'YIELD-RESET-%'
     or coalesce(new.provider_status,'') like 'cycle_reset:%'
     or coalesce(new.provider_status,'') like 'roi_debt_recovery:%' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;

  select outstanding into v_outstanding
  from bitnode_private.roi_recovery_debts where user_id = new.user_id for update;
  if not found or v_outstanding <= 0 then return new; end if;
  v_recovery := least(v_outstanding,new.amount);

  insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
  select 'ROI-DEBT-' || new.id,new.user_id,p.username,'yield',
    'Recuperación de ROI revertido por reinicio de ciclo',-v_recovery,'completed',
    'roi_debt_recovery:' || new.id
  from public.profiles p where p.id = new.user_id
  on conflict (id) do nothing;
  if found then
    update bitnode_private.roi_recovery_debts
    set outstanding = greatest(outstanding-v_recovery,0),
        recovered_total = recovered_total+v_recovery, updated_at = now()
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.recover_roi_reset_debt() from public, anon, authenticated;
drop trigger if exists recover_roi_reset_debt on public.transactions;
create trigger recover_roi_reset_debt
after insert or update of status on public.transactions
for each row execute function bitnode_private.recover_roi_reset_debt();

-- One authoritative business timezone for node tasks and SARA IA.
create or replace function bitnode_private.next_business_task_deadline(p_at timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select case extract(isodow from p_at at time zone 'America/Mexico_City')::integer
    when 6 then ((p_at at time zone 'America/Mexico_City') + interval '2 days') at time zone 'America/Mexico_City'
    when 7 then ((p_at at time zone 'America/Mexico_City') + interval '1 day') at time zone 'America/Mexico_City'
    else p_at end;
$$;
revoke all on function bitnode_private.next_business_task_deadline(timestamptz) from public, anon, authenticated;

do $patch$
declare
  v_tasks text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  v_sara text;
begin
  if position('America/Santo_Domingo' in v_tasks)>0 then
    execute replace(v_tasks,'America/Santo_Domingo','America/Mexico_City');
  elsif position('America/Mexico_City' in v_tasks)=0 then
    raise exception 'Unknown node weekday engine; review before changing timezone';
  end if;

  if to_regprocedure('bitnode_private.run_sara_ia_daily()') is not null then
    v_sara := pg_get_functiondef('bitnode_private.run_sara_ia_daily()'::regprocedure);
    if position('America/Santo_Domingo' in v_sara)>0 then
      execute replace(v_sara,'America/Santo_Domingo','America/Mexico_City');
    elsif position('America/Mexico_City' in v_sara)=0 then
      raise exception 'Unknown SARA weekday engine; review before changing timezone';
    end if;
  end if;
end;
$patch$;

update public.daily_task_cycles
set deadline_at=bitnode_private.next_business_task_deadline(deadline_at),updated_at=now()
where deadline_at is not null
  and extract(isodow from deadline_at at time zone 'America/Mexico_City') in (6,7);

notify pgrst,'reload schema';
commit;
