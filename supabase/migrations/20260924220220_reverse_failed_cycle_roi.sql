-- Future missed-task resets only. No retroactive balance changes.
create or replace function public.reset_daily_cycle_for_user(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reward record;
  v_balance numeric;
  v_debit numeric;
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
          -- Keep the original credit and an explicit, idempotent debit for audit.
          insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
          select 'YIELD-RESET-' || v_reward.id::text, p_user_id, username, 'yield',
            'Descuento por reinicio de nodo · tareas incumplidas', -v_debit, 'completed',
            'cycle_reset:' || v_reward.transaction_id
          from public.profiles where id = p_user_id
          on conflict (id) do nothing;
          if found then v_balance := v_balance - v_debit; end if;
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

-- Include the explicit reversal debits when calculating unspent finite-node ROI.
create or replace function bitnode_private.unspent_finite_node_roi(p_user_id uuid)
returns numeric language sql stable security invoker set search_path = '' as $$
  select greatest(coalesce((select sum(t.amount) from public.transactions t
    join public.contract_cycle_rewards r on r.transaction_id = t.id
    join public.contracts c on c.id = r.contract_id
    join public.plans p on p.id = c.plan_id
    where t.user_id = p_user_id and t.status = 'completed' and t.type = 'yield'
      and p.duration_days in (7,14,21)),0)
    + coalesce((select sum(d.amount) from public.transactions d
      join public.contract_cycle_rewards r on d.provider_status = 'cycle_reset:' || r.transaction_id
      join public.contracts c on c.id = r.contract_id
      join public.plans p on p.id = c.plan_id
      where d.user_id = p_user_id and r.user_id = p_user_id and d.type = 'yield'
        and d.id = 'YIELD-RESET-' || r.id::text and d.status = 'completed'
        and p.duration_days in (7,14,21)),0)
    - coalesce((select sum(t.node_roi_spent) from public.transactions t
      where t.user_id = p_user_id and t.node_roi_spent > 0
        and ((t.type = 'withdraw' and t.status in ('pending','approved','completed'))
          or (t.type = 'contract' and t.status = 'completed'))),0),0);
$$;
revoke all on function bitnode_private.unspent_finite_node_roi(uuid) from public, anon, authenticated;
grant execute on function bitnode_private.unspent_finite_node_roi(uuid) to service_role;

create or replace function public.get_account_ledger_summary(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'balance', coalesce(sum(t.amount) filter (where t.status = 'completed'
      or (t.type = 'withdraw' and t.status in ('pending','approved'))),0),
    'totalInvested', coalesce(-sum(t.amount) filter (where t.type = 'contract'
      and t.status = 'completed' and t.amount < 0),0),
    'totalYield', coalesce(sum(t.amount) filter (where t.id like 'YIELD-%'
      and t.type = 'yield' and t.status = 'completed'),0))
  from public.transactions t where t.user_id = p_user_id;
$$;
revoke all on function public.get_account_ledger_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_account_ledger_summary(uuid) to service_role;
notify pgrst, 'reload schema';
