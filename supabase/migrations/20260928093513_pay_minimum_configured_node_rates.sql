begin;

-- Future node rewards use the configured lower bound deterministically.
-- Historical rewards and plan display ranges remain unchanged.
do $patch$
declare
  definition text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  monthly_expression text := 'v_rate := round(coalesce(bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date), (v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric), 6); if v_rate <= 0 then continue; end if;';
  random_expression text := 'v_rate := round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6);';
  minimum_expression text := 'v_rate := v_contract.rate_min;';
begin
  if position(monthly_expression in definition) > 0 then
    execute replace(definition, monthly_expression, minimum_expression);
  elsif position(random_expression in definition) > 0 then
    execute replace(definition, random_expression, minimum_expression);
  elsif position(minimum_expression in definition) = 0 then
    raise exception 'Unknown node reward engine; review before applying minimum-rate policy.';
  end if;

  definition := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  if position(minimum_expression in definition) = 0
     or position('random() * (v_contract.rate_max - v_contract.rate_min)' in definition) > 0
     or position('monthly_daily_rate(v_contract.duration_days' in definition) > 0 then
    raise exception 'Minimum-rate policy was not installed cleanly.';
  end if;
end;
$patch$;

notify pgrst, 'reload schema';
commit;
