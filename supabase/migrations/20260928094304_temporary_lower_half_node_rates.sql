begin;

-- From Monday 2026-09-28 through Friday 2026-10-02, future node rewards
-- remain variable but are limited to the lower half of each configured range.
-- The existing business-day guard remains authoritative, and the normal full
-- range is restored automatically when this dated window ends.
do $patch$
declare
  definition text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  current_assignment constant text := 'v_rate := round(coalesce(bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date), (v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric), 6);';
begin
  if position('date ''2026-09-28''' in definition) > 0
     and position('date ''2026-10-02''' in definition) > 0 then
    null;
  elsif position(current_assignment in definition) = 0 then
    raise exception 'The installed v_rate assignment no longer matches the verified production definition.';
  else
    execute replace(
      definition,
      current_assignment,
      $rate$v_rate := case when current_date between date '2026-09-28' and date '2026-10-02' then round((v_contract.rate_min + random() * ((v_contract.rate_max - v_contract.rate_min) / 2))::numeric, 6) else round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6) end;$rate$
    );
  end if;

  definition := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  if position('date ''2026-09-28''' in definition) = 0
     or position('date ''2026-10-02''' in definition) = 0
     or position('(v_contract.rate_max - v_contract.rate_min) / 2' in definition) = 0
     or position('extract(isodow from now() at time zone ''America/Santo_Domingo'') between 1 and 5' in definition) = 0
     or position('not between 1 and 5' in definition) = 0 then
    raise exception 'Temporary policy or Monday-Friday guard was not installed cleanly.';
  end if;
end;
$patch$;

notify pgrst, 'reload schema';
commit;
