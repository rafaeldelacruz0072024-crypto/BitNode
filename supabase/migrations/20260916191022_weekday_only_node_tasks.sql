-- Saturday and Sunday are rest days in Santo Domingo. Carry any 24-hour
-- deadline into Monday at the same local clock time.
begin;

create or replace function bitnode_private.next_business_task_deadline(p_at timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select case extract(isodow from p_at at time zone 'America/Santo_Domingo')::integer
    when 6 then ((p_at at time zone 'America/Santo_Domingo') + interval '2 days') at time zone 'America/Santo_Domingo'
    when 7 then ((p_at at time zone 'America/Santo_Domingo') + interval '1 day') at time zone 'America/Santo_Domingo'
    else p_at end;
$$;
revoke all on function bitnode_private.next_business_task_deadline(timestamptz) from public, anon, authenticated;

do $patch$
declare
  v_tasks text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  v_scheduler text := pg_get_functiondef('bitnode_private.enforce_daily_node_continuity()'::regprocedure);
  v_marker text := 'if not (p_task_key = any(v_allowed_tasks)) then';
  v_old_deadline text := 'now() + interval ''24 hours''';
  v_new_deadline text := 'bitnode_private.next_business_task_deadline(now() + interval ''24 hours'')';
  v_old_next text := 'v_cycle.deadline_at + interval ''24 hours''';
  v_new_next text := 'bitnode_private.next_business_task_deadline(v_cycle.deadline_at + interval ''24 hours'')';
begin
  if position(v_marker in v_tasks) = 0
     or position('extract(isodow from now()) between 1 and 5' in v_tasks) = 0
     or position(v_old_deadline in v_tasks) = 0
     or position('v_next_deadline := ' || v_old_next in v_scheduler) = 0 then
    raise exception 'Unexpected node task engine; review weekday migration before applying';
  end if;

  v_tasks := replace(v_tasks, 'extract(isodow from now()) between 1 and 5',
    'extract(isodow from now() at time zone ''America/Santo_Domingo'') between 1 and 5');
  v_tasks := replace(v_tasks, v_marker,
    'if extract(isodow from now() at time zone ''America/Santo_Domingo'') not between 1 and 5 then
    raise exception ''Las tareas de los nodos solo están disponibles de lunes a viernes (hora de Santo Domingo).'' using errcode = ''P0001'';
  end if;
  ' || v_marker);
  v_tasks := replace(v_tasks, v_old_deadline, v_new_deadline);
  execute v_tasks;

  v_scheduler := replace(v_scheduler, 'v_next_deadline := ' || v_old_next,
    'v_next_deadline := ' || v_new_next);
  execute v_scheduler;
end;
$patch$;

-- Protect windows already open before this change, including Friday's.
update public.daily_task_cycles
set deadline_at = bitnode_private.next_business_task_deadline(deadline_at), updated_at = now()
where deadline_at is not null
  and extract(isodow from deadline_at at time zone 'America/Santo_Domingo') in (6, 7);

notify pgrst, 'reload schema';
commit;
