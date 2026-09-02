-- Hace visible el vencimiento de 24 horas al entrar al panel, sin esperar a
-- que el usuario pulse otra tarea. Solo revierte rendimientos provisionales;
-- el capital de los contratos nunca se altera.

create or replace function public.get_daily_task_cycle()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cycle public.daily_task_cycles%rowtype;
  v_cycle_reset boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authenticated user is required';
  end if;

  select * into v_cycle
  from public.daily_task_cycles
  where user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'cycle_day', 0,
      'completed_tasks', '[]'::jsonb,
      'remaining_tasks', 4,
      'deadline_at', null,
      'last_task_at', null,
      'last_completed_at', null,
      'cycle_reset', false
    );
  end if;

  if (v_cycle.last_completed_at is not null
      and v_cycle.last_completed_at <= now() - interval '24 hours')
     or (v_cycle.window_started_at is not null
         and cardinality(v_cycle.completed_tasks) < 4
         and v_cycle.window_started_at <= now() - interval '24 hours') then
    perform public.reset_daily_cycle_for_user(v_user_id, 'missed_24h_window');
    v_cycle_reset := true;

    select * into v_cycle
    from public.daily_task_cycles
    where user_id = v_user_id;
  end if;

  return jsonb_build_object(
    'cycle_day', v_cycle.cycle_day,
    'completed_tasks', to_jsonb(v_cycle.completed_tasks),
    'remaining_tasks', greatest(0, 4 - cardinality(v_cycle.completed_tasks)),
    'deadline_at', v_cycle.deadline_at,
    'last_task_at', v_cycle.last_task_at,
    'last_completed_at', v_cycle.last_completed_at,
    'cycle_reset', v_cycle_reset
  );
end;
$$;

revoke all on function public.get_daily_task_cycle() from public, anon;
grant execute on function public.get_daily_task_cycle() to authenticated;
