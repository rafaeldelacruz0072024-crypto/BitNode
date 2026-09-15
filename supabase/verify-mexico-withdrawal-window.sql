-- Run read-only after 20260915223037_mexico_wednesday_withdrawal_buckets.sql.
-- A Wednesday in September 2026 is UTC-6 in America/Mexico_City.
with sample_user as (select id from public.profiles limit 1),
moments(label, at_utc, expected_open) as (values
  ('Wednesday 07:59 Mexico', '2026-09-16 13:59:00+00'::timestamptz, false),
  ('Wednesday 08:00 Mexico', '2026-09-16 14:00:00+00'::timestamptz, true),
  ('Wednesday 14:59 Mexico', '2026-09-16 20:59:00+00'::timestamptz, true),
  ('Wednesday 15:00 Mexico', '2026-09-16 21:00:00+00'::timestamptz, false),
  ('Thursday 08:00 Mexico', '2026-09-17 14:00:00+00'::timestamptz, false)
)
select m.label, m.expected_open,
  (public.get_withdrawal_availability(u.id,m.at_utc)->>'weeklyWindowOpen')::boolean as actual_open,
  public.get_withdrawal_availability(u.id,m.at_utc)->>'scheduleTimezone' as timezone
from moments m cross join sample_user u;

-- Source buckets cannot exceed the user's actual balance when withdrawing.
select count(*) as invalid_withdrawable_balances
from (select id from public.profiles order by created_at desc limit 10) p
cross join lateral public.get_withdrawal_availability(p.id, now()) a
where (a->>'withdrawableBalance')::numeric < 0
  or (a->>'withdrawableBalance')::numeric > greatest((a->>'balance')::numeric,0);

-- The admin emergency hold must be explicit and visible.
select key, value from public.platform_settings where key = 'withdrawal_window';

-- Existing reservation rows keep their ROI attribution; future rows also
-- record direct and binary/rank attribution separately.
select count(*) as source_allocation_overflows from public.transactions t
where t.node_roi_spent + t.direct_commission_spent + t.weekly_bonus_spent > greatest(-t.amount,0);
