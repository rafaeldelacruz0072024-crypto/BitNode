begin;

-- From Monday 2026-09-28 through Friday 2026-10-02, future node rewards
-- remain variable but are limited to the lower half of each configured range.
-- The existing business-day guard remains authoritative, and the normal full
-- range is restored automatically when this dated window ends.
do $patch$
declare
  definition text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  rate_assignment_pattern constant text := 'v_rate[[:space:]]*:=[[:space:]]*[^;]+;';
  temporary_expression constant text := 'v_rate := case when current_date between date ''2026-09-28'' and date ''2026-10-02'' then round((v_contract.rate_min + random() * ((v_contract.rate_max - v_contract.rate_min) / 2))::numeric, 6) else round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6) end;';
  assignment_count integer;
begin
  -- pg_get_functiondef preserves whitespace from the stored PL/pgSQL body, so
  -- exact one-line comparisons are not reliable. Match the single assignment
  -- structurally and refuse to continue if the engine has none or several.
  select count(*)
    into assignment_count
    from regexp_matches(definition, rate_assignment_pattern, 'g');

  if assignment_count <> 1 then
    raise exception 'Expected exactly one v_rate assignment, found %. Review complete_daily_tasks before applying.', assignment_count;
  end if;

  execute regexp_replace(definition, rate_assignment_pattern, temporary_expression);

  definition := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  if position('date ''2026-09-28''' in definition) = 0
     or position('date ''2026-10-02''' in definition) = 0
     or position('(v_contract.rate_max - v_contract.rate_min) / 2' in definition) = 0
     or definition !~ 'extract\(isodow[[:space:]]+from[[:space:]]+now\(\)\)[[:space:]]+between[[:space:]]+1[[:space:]]+and[[:space:]]+5' then
    raise exception 'Temporary policy or Monday-Friday guard was not installed cleanly.';
  end if;
end;
$patch$;

notify pgrst, 'reload schema';
commit;
