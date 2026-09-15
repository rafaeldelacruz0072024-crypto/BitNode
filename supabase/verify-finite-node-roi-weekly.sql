-- Run read-only after 20260915172604_credit_finite_node_roi_weekly_release_principal.sql.
-- All earned finite-node ROI must be completed in the ledger; progress may
-- remain pending until the node's day 7/14/21.
select count(*) as finite_roi_not_credited
from public.contract_cycle_rewards r
join public.contracts c on c.id = r.contract_id
join public.plans p on p.id = c.plan_id
join public.transactions t on t.id = r.transaction_id
where p.duration_days in (7, 14, 21)
  and r.status in ('pending', 'completed')
  and (t.status <> 'completed' or t.type <> 'yield');

-- No active finite contract should have released its principal.
select count(*) as early_principal_releases
from public.contracts c
join public.plans p on p.id = c.plan_id
join public.transactions t on t.id = 'PRINCIPAL-' || c.id::text
where p.duration_days in (7, 14, 21) and c.status = 'active';

-- These plans must return capital when their progress reaches the term.
select id, duration_days, principal_returned
from public.plans
where duration_days in (7, 14, 21)
order by duration_days;

-- Compare a user's Wednesday and Thursday availability at Santo Domingo time.
-- Replace the UUID with a finite-node holder when investigating a specific account.
-- select public.get_withdrawal_availability('USER-UUID'::uuid,
--   '2026-09-16 16:00:00+00'::timestamptz) as wednesday,
--   public.get_withdrawal_availability('USER-UUID'::uuid,
--   '2026-09-17 16:00:00+00'::timestamptz) as thursday;
