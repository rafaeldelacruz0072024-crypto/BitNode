-- Run after the migration. This is read-only and returns one verification row.
with sample_user as (
  select id from public.profiles order by created_at limit 1
), checks as (
  select
    public.get_withdrawal_availability(id, '2026-09-16 12:00:00-04'::timestamptz) as wednesday,
    public.get_withdrawal_availability(id, '2026-09-17 12:00:00-04'::timestamptz) as thursday
  from sample_user
)
select
  to_regprocedure('public.get_withdrawal_availability(uuid,timestamptz)') is not null as function_installed,
  coalesce((wednesday ->> 'binaryAndRankWindowOpen')::boolean, false) as wednesday_open,
  not coalesce((thursday ->> 'binaryAndRankWindowOpen')::boolean, true) as thursday_closed,
  coalesce(wednesday ->> 'scheduleTimezone', '') = 'America/Santo_Domingo' as timezone_correct,
  coalesce((wednesday ->> 'directMaturesAfterHours')::integer, 0) = 24 as direct_uses_24_hours
from checks;
