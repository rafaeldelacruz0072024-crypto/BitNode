begin;

-- From Monday 2026-09-28 through Friday 2026-10-02, future node rewards
-- remain variable but are limited to the lower half of each configured range.
-- The existing business-day guard remains authoritative, and the normal full
-- range is restored automatically when this dated window ends.
do $patch$
declare
  definition text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  monthly_expression text := 'v_rate := round(coalesce(bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date), (v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric), 6); if v_rate <= 0 then continue; end if;';
  random_expression text := 'v_rate := round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6);';
  minimum_expression text := 'v_rate := v_contract.rate_min;';
  temporary_expression text := 'v_rate := case when current_date between date ''2026-09-28'' and date ''2026-10-02'' then round((v_contract.rate_min + random() * ((v_contract.rate_max - v_contract.rate_min) / 2))::numeric, 6) else round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6) end;';
begin
  if position(temporary_expression in definition) > 0 then
    null;
  elsif position(monthly_expression in definition) > 0 then
    execute replace(definition, monthly_expression, temporary_expression);
  elsif position(random_expression in definition) > 0 then
    execute replace(definition, random_expression, temporary_expression);
  elsif position(minimum_expression in definition) > 0 then
    execute replace(definition, minimum_expression, temporary_expression);
  else
    raise exception 'Unknown node reward engine; review before applying temporary lower-half policy.';
  end if;

  definition := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  if position(temporary_expression in definition) = 0
     or position('v_is_business_day boolean := extract(isodow from now()) between 1 and 5' in definition) = 0 then
    raise exception 'Temporary policy or Monday-Friday guard was not installed cleanly.';
  end if;
end;
$patch$;

notify pgrst, 'reload schema';
commit;
