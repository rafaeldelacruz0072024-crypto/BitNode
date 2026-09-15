-- Finite-node ROI is credited after each successful 4/4 business-day cycle.
-- Reward rows remain pending solely to track the node's 7/14/21-day progress.
-- The principal is released only when that progress reaches the plan duration.

alter table public.transactions add column if not exists node_roi_spent numeric(18,2) not null default 0;
alter table public.transactions drop constraint if exists transactions_node_roi_spent_check;
alter table public.transactions add constraint transactions_node_roi_spent_check
  check (node_roi_spent >= 0 and node_roi_spent <= greatest(-amount, 0));

create or replace function bitnode_private.unspent_finite_node_roi(p_user_id uuid)
returns numeric language sql stable security invoker set search_path = '' as $$
  select greatest(
    coalesce((select sum(t.amount) from public.transactions t
      join public.contract_cycle_rewards r on r.transaction_id = t.id
      join public.contracts c on c.id = r.contract_id
      join public.plans p on p.id = c.plan_id
      where t.user_id = p_user_id and t.status = 'completed'
        and t.type = 'yield' and p.duration_days in (7, 14, 21)), 0)
    - coalesce((select sum(t.node_roi_spent) from public.transactions t
      where t.user_id = p_user_id and t.node_roi_spent > 0
        and ((t.type = 'withdraw' and t.status in ('pending','approved','completed'))
          or (t.type = 'contract' and t.status = 'completed'))), 0), 0);
$$;
revoke all on function bitnode_private.unspent_finite_node_roi(uuid) from public, anon, authenticated;
grant execute on function bitnode_private.unspent_finite_node_roi(uuid) to service_role;

-- Preserve already-earned ROI. A continuity reset may restart node progress,
-- but can no longer reverse money that the user could already have withdrawn.
create or replace function public.reset_daily_cycle_for_user(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.daily_task_cycles where user_id = p_user_id for update;
  if p_reason = 'missed_24h_window' then
    insert into public.user_notifications(user_id, kind)
    select p_user_id, 'cycle_reset' from public.daily_task_cycles
    where user_id = p_user_id and (cycle_day > 0 or cardinality(completed_tasks) > 0
      or window_started_at is not null or last_completed_at is not null);
  end if;
  update public.contract_cycle_rewards r set status = 'reversed', updated_at = now()
  from public.contracts c
  where r.user_id = p_user_id and c.id = r.contract_id and c.user_id = p_user_id
    and c.status = 'active' and r.status = 'pending';
  update public.daily_task_cycles set cycle_day = 0, completed_tasks = array[]::text[],
    window_started_at = null, deadline_at = null, last_task_at = now(),
    last_completed_at = null, updated_at = now() where user_id = p_user_id;
end;
$$;
revoke all on function public.reset_daily_cycle_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.reset_daily_cycle_for_user(uuid,text) to service_role;

do $patch_tasks$
declare v_old text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
        v_new text;
begin
  if position('bitnode_private.monthly_daily_rate' in v_old) = 0
     or position('v_effective_days >= v_contract.duration_days' in v_old) = 0 then
    raise exception 'Unexpected daily-task engine; inspect before crediting finite ROI.';
  end if;
  v_new := replace(v_old,
    $old$             v_reward,
             case when v_contract.duration_days is null then 'completed' else 'pending' end,
             now()$old$,
    $new$             v_reward,
             'completed',
             now()$new$);
  v_new := replace(v_new,
    $old$        'status', case when v_contract.duration_days is null then 'completed' else 'pending' end,
        'transaction_id'$old$,
    $new$        'status', 'completed',
        'transaction_id'$new$);
  v_new := replace(v_new,
    $old$      if v_contract.duration_days is null then
        v_total_available := v_total_available + v_reward;
      else
        v_total_pending := v_total_pending + v_reward;$old$,
    $new$      v_total_available := v_total_available + v_reward;
      if v_contract.duration_days is not null then$new$);
  if v_new = v_old or position('v_total_pending := v_total_pending + v_reward' in v_new) > 0
     or position($old$             'completed',
             now()$old$ in v_new) = 0 then
    raise exception 'Finite-node ROI patch did not match the installed task function.';
  end if;
  execute v_new;
end;
$patch_tasks$;

-- Successful earlier days already belong to the user; legacy pending ledger
-- rows become completed without advancing the node's progress or its capital.
update public.transactions t set status = 'completed'
from public.contract_cycle_rewards r
join public.contracts c on c.id = r.contract_id
join public.plans p on p.id = c.plan_id
where t.id = r.transaction_id and t.user_id = r.user_id
  and t.status = 'pending' and t.type = 'yield'
  and r.status = 'pending' and p.duration_days in (7,14,21);

-- The ROI metric excludes referral commissions, which also use type='yield'.
create or replace function public.get_account_ledger_summary(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'balance', coalesce(sum(t.amount) filter (where t.status = 'completed'
      or (t.type = 'withdraw' and t.status in ('pending','approved'))), 0),
    'totalInvested', coalesce(-sum(t.amount) filter (where t.type = 'contract'
      and t.status = 'completed' and t.amount < 0), 0),
    'totalYield', coalesce(sum(t.amount) filter (where t.id like 'YIELD-%'
      and t.type = 'yield' and t.status = 'completed' and t.amount > 0), 0)
  ) from public.transactions t where t.user_id = p_user_id;
$$;
revoke all on function public.get_account_ledger_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_account_ledger_summary(uuid) to service_role;

do $patch_availability$
declare v_old text := pg_get_functiondef('public.get_withdrawal_availability(uuid,timestamptz)'::regprocedure);
        v_new text;
begin
  v_new := replace(v_old, 'v_locked_wednesday numeric := 0;',
    'v_locked_wednesday numeric := 0;' || chr(10) || '  v_locked_node_roi numeric := 0;');
  v_new := replace(v_new,
    $old$  from public.transactions t
  where t.user_id = p_user_id;

  select$old$,
    $new$  from public.transactions t
  where t.user_id = p_user_id;

  if not v_is_wednesday then
    v_locked_node_roi := least(bitnode_private.unspent_finite_node_roi(p_user_id), greatest(v_total, 0));
  end if;

  select$new$);
  v_new := replace(v_new,
    $old$'withdrawableBalance', greatest(v_total - v_locked_direct - v_locked_wednesday, 0),$old$,
    $new$'withdrawableBalance', greatest(v_total - v_locked_direct - v_locked_wednesday - v_locked_node_roi, 0),
    'lockedNodeRoi', v_locked_node_roi,$new$);
  if v_new = v_old or position('lockedNodeRoi' in v_new) = 0
     or position('v_locked_node_roi := least' in v_new) = 0 then
    raise exception 'Unexpected withdrawal-availability function.';
  end if;
  execute v_new;
end;
$patch_availability$;

do $patch_validation$
declare v_old text := pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure);
        v_new text;
begin
  v_new := replace(v_old, 'v_locked_wednesday numeric;',
    'v_locked_wednesday numeric;' || chr(10) || '  v_locked_node_roi numeric;');
  v_new := replace(v_new,
    $old$  v_locked_wednesday := (v_availability ->> 'lockedWednesday')::numeric;$old$,
    $new$  v_locked_wednesday := (v_availability ->> 'lockedWednesday')::numeric;
  v_locked_node_roi := (v_availability ->> 'lockedNodeRoi')::numeric;$new$);
  v_new := replace(v_new, '  if v_withdrawable < p_amount then',
    $new$  if v_withdrawable < p_amount then
    if v_locked_node_roi > 0 then
      raise exception 'El ROI de nodos de 7, 14 y 21 días solo se retira los miércoles, hora de Santo Domingo.' using errcode = 'P0001';
    end if;$new$);
  if v_new = v_old or position('v_locked_node_roi > 0' in v_new) = 0 then
    raise exception 'Unexpected withdrawal-validation function.';
  end if;
  execute v_new;
end;
$patch_validation$;

-- Attribute weekly withdrawals and node purchases to the ROI bucket so an
-- already-used ROI cannot keep blocking unrelated future deposits.
do $patch_guard$
declare v_old text := pg_get_functiondef('bitnode_private.guard_reserved_ledger()'::regprocedure);
        v_new text;
begin
  v_new := replace(v_old,
    $old$      if (new.id, new.type, new.amount, new.network, new.wallet, new.fee, new.net_amount, new.email_challenge_id, new.created_at)
        is distinct from (old.id, old.type, old.amount, old.network, old.wallet, old.fee, old.net_amount, old.email_challenge_id, old.created_at) then$old$,
    $new$      if (new.id, new.type, new.amount, new.network, new.wallet, new.fee, new.net_amount, new.email_challenge_id, new.created_at, new.node_roi_spent)
        is distinct from (old.id, old.type, old.amount, old.network, old.wallet, old.fee, old.net_amount, old.email_challenge_id, old.created_at, old.node_roi_spent) then$new$);
  v_new := replace(v_new,
    $old$    perform public.validate_withdrawal_request(new.user_id, -new.amount);
    new.created_at := now();$old$,
    $new$    perform public.validate_withdrawal_request(new.user_id, -new.amount);
    new.node_roi_spent := case when extract(isodow from now() at time zone 'America/Santo_Domingo') = 3
      then least(-new.amount, bitnode_private.unspent_finite_node_roi(new.user_id)) else 0 end;
    new.created_at := now();$new$);
  v_new := replace(v_new,
    '  if v_new_impact < v_old_impact then',
    $new$  if tg_op = 'INSERT' and new.type = 'contract' and new.status = 'completed' and new.amount < 0 then
    new.node_roi_spent := least(-new.amount, bitnode_private.unspent_finite_node_roi(new.user_id));
  end if;
  if v_new_impact < v_old_impact then$new$);
  if v_new = v_old or position('new.node_roi_spent := case' in v_new) = 0
     or position($check$new.type = 'contract'$check$ in v_new) = 0 then
    raise exception 'Unexpected reserved-ledger guard.';
  end if;
  execute v_new;
end;
$patch_guard$;

notify pgrst, 'reload schema';
