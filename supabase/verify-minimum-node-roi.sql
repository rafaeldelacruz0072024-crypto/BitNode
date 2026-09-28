-- Read-only verification after applying 20260928093513_pay_minimum_configured_node_rates.sql.
select
  position('v_rate := v_contract.rate_min;' in pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure)) > 0
    as minimum_rate_active,
  position('random() * (v_contract.rate_max - v_contract.rate_min)' in pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure)) = 0
    as random_rate_disabled,
  position('monthly_daily_rate(v_contract.duration_days' in pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure)) = 0
    as monthly_override_disabled;

select id, name, rate_min * 100 as payment_percent, rate_max * 100 as published_range_max
from public.plans
where id in ('daily', '7d', '14d', '21d')
order by case id when 'daily' then 1 when '7d' then 2 when '14d' then 3 else 4 end;
