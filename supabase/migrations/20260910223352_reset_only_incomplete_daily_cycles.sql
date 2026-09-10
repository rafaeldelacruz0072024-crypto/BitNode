-- A completed 4/4 day is successful even after its deadline passes. Reset only
-- an opened task window that expired before all four tasks were completed.
-- reset_daily_cycle_for_user keeps capital untouched and reverses pending node
-- rewards, which also returns finite-node progress to zero.
do $migration$
declare
  v_function_name text;
  v_source text;
  v_old_condition text := $old$
  if (v_cycle.last_completed_at is not null and v_cycle.last_completed_at <= now() - interval '24 hours')
     or (v_cycle.window_started_at is not null
         and cardinality(v_cycle.completed_tasks) < 4
         and v_cycle.window_started_at <= now() - interval '24 hours') then
$old$;
  v_new_condition text := $new$
  if v_cycle.window_started_at is not null
     and cardinality(v_cycle.completed_tasks) < 4
     and coalesce(v_cycle.deadline_at, v_cycle.window_started_at + interval '24 hours') <= now() then
$new$;
begin
  foreach v_function_name in array array['get_daily_task_cycle()', 'complete_daily_tasks(text)']
  loop
    v_source := pg_get_functiondef(('public.' || v_function_name)::regprocedure);

    if position(v_old_condition in v_source) = 0 then
      raise exception 'Unexpected definition for public.%; review before applying incomplete-cycle reset patch',
        v_function_name;
    end if;

    execute replace(v_source, v_old_condition, v_new_condition);
  end loop;
end;
$migration$;

-- Fail the migration if either public entry point can still reset a completed
-- cycle merely because last_completed_at is older than 24 hours.
do $verification$
declare
  v_function_name text;
  v_source text;
begin
  foreach v_function_name in array array['get_daily_task_cycle()', 'complete_daily_tasks(text)']
  loop
    v_source := pg_get_functiondef(('public.' || v_function_name)::regprocedure);

    if position('v_cycle.last_completed_at <= now() - interval ''24 hours''' in v_source) > 0
       or position('cardinality(v_cycle.completed_tasks) < 4' in v_source) = 0
       or position('coalesce(v_cycle.deadline_at, v_cycle.window_started_at + interval ''24 hours'') <= now()' in v_source) = 0 then
      raise exception 'Incomplete-cycle reset guard is not active in public.%', v_function_name;
    end if;
  end loop;
end;
$verification$;
