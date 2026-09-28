-- Read-only verification after applying 20260928094304_temporary_lower_half_node_rates.sql.
with engine as (
  select pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure) as definition
)
select
  position('date ''2026-09-28''' in definition) > 0 as starts_on_monday,
  position('date ''2026-10-02''' in definition) > 0 as ends_on_friday,
  position('(v_contract.rate_max - v_contract.rate_min) / 2' in definition) > 0 as lower_half_active,
  position('else round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6)' in definition) > 0 as full_range_auto_restore,
  position('v_is_business_day boolean := extract(isodow from now()) between 1 and 5' in definition) > 0 as monday_to_friday_only
from engine;

select *
from (values
  ('Nodo Diario', 1.00::numeric, 1.25::numeric),
  ('Nodo 7 Días', 2.00::numeric, 2.50::numeric),
  ('Nodo 14 Días', 3.00::numeric, 3.50::numeric),
  ('Nodo 21 Días', 4.00::numeric, 4.50::numeric)
) as expected(plan, temporary_min_percent, temporary_max_percent);
