-- BitNode production report through the database current date.
-- READ ONLY: this file contains SELECT statements only.

-- 1) Executive payout report by plan.
with reward_by_contract as (
  select
    reward.contract_id,
    count(*) filter (where reward.status <> 'reversed') as generated_days,
    count(*) filter (where reward.status = 'completed') as paid_days,
    coalesce(sum(reward.amount) filter (where reward.status <> 'reversed'), 0) as generated_amount,
    coalesce(sum(reward.amount) filter (where reward.status = 'completed'), 0) as paid_amount,
    coalesce(sum(reward.amount) filter (where reward.status = 'pending'), 0) as pending_amount,
    coalesce(sum(reward.amount) filter (where reward.status = 'reversed'), 0) as reversed_amount
  from public.contract_cycle_rewards as reward
  where reward.reward_date <= current_date
  group by reward.contract_id
), contract_report as (
  select
    contract.id,
    contract.plan_id,
    contract.amount as capital,
    contract.status,
    contract.principal_returned_at,
    coalesce(reward.generated_days, 0) as generated_days,
    coalesce(reward.paid_days, 0) as paid_days,
    coalesce(reward.generated_amount, 0) as generated_amount,
    coalesce(reward.paid_amount, 0) as paid_amount,
    coalesce(reward.pending_amount, 0) as pending_amount,
    coalesce(reward.reversed_amount, 0) as reversed_amount
  from public.contracts as contract
  left join reward_by_contract as reward on reward.contract_id = contract.id
)
select
  current_date as report_date,
  plan.name as node_plan,
  count(*) as contracts,
  count(*) filter (where report.status = 'active') as active_contracts,
  round(sum(report.capital), 2) as total_capital,
  round(sum(report.generated_amount), 2) as total_generated,
  round(100 * sum(report.generated_amount) / nullif(sum(report.capital), 0), 4) as generated_roi_percent,
  round(sum(report.paid_amount), 2) as total_paid_released,
  round(100 * sum(report.paid_amount) / nullif(sum(report.capital), 0), 4) as paid_roi_percent,
  round(sum(report.pending_amount), 2) as pending_amount,
  round(sum(report.reversed_amount), 2) as reversed_by_resets,
  count(*) filter (where report.principal_returned_at is not null) as principal_returns
from contract_report as report
join public.plans as plan on plan.id = report.plan_id
group by plan.id, plan.name
order by plan.duration_days nulls first;

-- 2) Payout detail by user and node. paid_roi_percent is the percentage of
-- that contract's capital already released as completed yield.
with reward_by_contract as (
  select
    reward.contract_id,
    count(*) filter (where reward.status <> 'reversed') as generated_days,
    count(*) filter (where reward.status = 'completed') as paid_days,
    round(coalesce(avg(reward.rate) filter (where reward.status <> 'reversed'), 0) * 100, 4) as average_daily_rate_percent,
    coalesce(sum(reward.amount) filter (where reward.status <> 'reversed'), 0) as generated_amount,
    coalesce(sum(reward.amount) filter (where reward.status = 'completed'), 0) as paid_amount,
    coalesce(sum(reward.amount) filter (where reward.status = 'pending'), 0) as pending_amount,
    coalesce(sum(reward.amount) filter (where reward.status = 'reversed'), 0) as reversed_amount
  from public.contract_cycle_rewards as reward
  where reward.reward_date <= current_date
  group by reward.contract_id
)
select
  profile.username,
  auth_user.email,
  contract.id as contract_id,
  plan.name as node_plan,
  contract.status as node_status,
  contract.amount as capital,
  coalesce(reward.generated_days, 0) as generated_days,
  coalesce(reward.paid_days, 0) as paid_days,
  coalesce(reward.average_daily_rate_percent, 0) as average_daily_rate_percent,
  round(coalesce(reward.generated_amount, 0), 2) as generated_amount,
  round(100 * coalesce(reward.generated_amount, 0) / nullif(contract.amount, 0), 4) as generated_roi_percent,
  round(coalesce(reward.paid_amount, 0), 2) as paid_amount,
  round(100 * coalesce(reward.paid_amount, 0) / nullif(contract.amount, 0), 4) as paid_roi_percent,
  round(coalesce(reward.pending_amount, 0), 2) as pending_amount,
  round(coalesce(reward.reversed_amount, 0), 2) as reversed_by_resets,
  contract.principal_returned_at
from public.contracts as contract
join public.plans as plan on plan.id = contract.plan_id
join public.profiles as profile on profile.id = contract.user_id
join auth.users as auth_user on auth_user.id = contract.user_id
left join reward_by_contract as reward on reward.contract_id = contract.id
order by profile.username, contract.created_at;

-- 3) Users with confirmed 24-hour cycle resets. A reset clears task progress
-- and reverses pending finite-plan yield; it does not recreate or move a node.
with reset_history as (
  select
    notice.user_id,
    count(*) as reset_count,
    min(notice.created_at) as first_reset_at,
    max(notice.created_at) as last_reset_at
  from public.user_notifications as notice
  where notice.kind = 'cycle_reset'
    and notice.created_at <= now()
  group by notice.user_id
), reversed_rewards as (
  select
    reward.user_id,
    count(*) filter (where reward.status = 'reversed') as reversed_reward_rows,
    coalesce(sum(reward.amount) filter (where reward.status = 'reversed'), 0) as reversed_reward_amount
  from public.contract_cycle_rewards as reward
  where reward.reward_date <= current_date
  group by reward.user_id
), node_counts as (
  select
    contract.user_id,
    count(*) as total_nodes,
    count(*) filter (where contract.status = 'active') as active_nodes,
    count(*) filter (where contract.status = 'completed') as completed_nodes
  from public.contracts as contract
  group by contract.user_id
)
select
  profile.username,
  auth_user.email,
  reset.reset_count,
  reset.first_reset_at,
  reset.last_reset_at,
  coalesce(cycle.cycle_day, 0) as current_cycle_day,
  cardinality(coalesce(cycle.completed_tasks, array[]::text[])) as current_tasks_completed,
  cycle.last_completed_at,
  coalesce(nodes.total_nodes, 0) as total_nodes,
  coalesce(nodes.active_nodes, 0) as active_nodes,
  coalesce(nodes.completed_nodes, 0) as completed_nodes,
  coalesce(reward.reversed_reward_rows, 0) as reversed_reward_rows,
  round(coalesce(reward.reversed_reward_amount, 0), 2) as reversed_reward_amount,
  'TASK_CYCLE_RESET_CONFIRMED' as audit_status
from reset_history as reset
join public.profiles as profile on profile.id = reset.user_id
join auth.users as auth_user on auth_user.id = reset.user_id
left join public.daily_task_cycles as cycle on cycle.user_id = reset.user_id
left join reversed_rewards as reward on reward.user_id = reset.user_id
left join node_counts as nodes on nodes.user_id = reset.user_id
order by reset.last_reset_at desc;

-- 4) Users currently at 4/4 tasks. Node audit verifies active contracts,
-- duplicate daily rewards and whether a reset occurred after completion.
with duplicate_rewards as (
  select reward.contract_id, reward.reward_date
  from public.contract_cycle_rewards as reward
  group by reward.contract_id, reward.reward_date
  having count(*) > 1
), user_node_audit as (
  select
    contract.user_id,
    count(*) as total_nodes,
    count(*) filter (where contract.status = 'active') as active_nodes,
    count(*) filter (where contract.status = 'completed') as completed_nodes,
    count(*) filter (
      where contract.status = 'active'
        and plan.duration_days is not null
        and contract.ends_at is not null
    ) as invalid_active_expiry,
    count(duplicate.contract_id) as duplicate_reward_dates
  from public.contracts as contract
  join public.plans as plan on plan.id = contract.plan_id
  left join duplicate_rewards as duplicate on duplicate.contract_id = contract.id
  group by contract.user_id
), latest_reset as (
  select notice.user_id, max(notice.created_at) as last_reset_at
  from public.user_notifications as notice
  where notice.kind = 'cycle_reset'
  group by notice.user_id
)
select
  profile.username,
  auth_user.email,
  cycle.cycle_day,
  cardinality(cycle.completed_tasks) as tasks_completed,
  cycle.last_completed_at,
  cycle.deadline_at,
  audit.total_nodes,
  audit.active_nodes,
  audit.completed_nodes,
  reset.last_reset_at,
  audit.invalid_active_expiry,
  audit.duplicate_reward_dates,
  case
    when audit.active_nodes < 1 then 'REVIEW_NO_ACTIVE_NODE'
    when reset.last_reset_at is not null and reset.last_reset_at > cycle.last_completed_at then 'REVIEW_RESET_AFTER_COMPLETION'
    when cycle.deadline_at <= now()
      and cardinality(cycle.completed_tasks) < 4 then 'REVIEW_RESET_DUE'
    when audit.invalid_active_expiry > 0 then 'REVIEW_ACTIVE_NODE_EXPIRY'
    when audit.duplicate_reward_dates > 0 then 'REVIEW_DUPLICATE_REWARDS'
    else 'TASKS_100_PERCENT_NODE_OK_NOT_RESET'
  end as audit_status
from public.daily_task_cycles as cycle
join public.profiles as profile on profile.id = cycle.user_id
join auth.users as auth_user on auth_user.id = cycle.user_id
join user_node_audit as audit on audit.user_id = cycle.user_id
left join latest_reset as reset on reset.user_id = cycle.user_id
where cardinality(cycle.completed_tasks) = 4
  and cycle.last_completed_at is not null
order by cycle.last_completed_at desc;
