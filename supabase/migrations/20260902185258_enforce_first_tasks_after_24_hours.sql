-- Regla de oro BitNode:
-- una cuenta nueva espera 24 horas exactas desde su registro antes de iniciar
-- su primera jornada de tareas. El control se aplica en base de datos.

create or replace function public.enforce_daily_task_registration_delay()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_available_at timestamptz;
begin
  select u.created_at + interval '24 hours'
  into v_available_at
  from auth.users u
  where u.id = new.user_id;

  if v_available_at is null then
    raise exception 'No se encontró la fecha de registro del usuario';
  end if;

  if now() < v_available_at then
    raise exception 'Las tareas diarias se habilitan 24 horas después del registro. Disponibles desde %', v_available_at;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_daily_task_registration_delay() from public, anon, authenticated;

drop trigger if exists enforce_daily_task_registration_delay on public.daily_task_cycles;
create trigger enforce_daily_task_registration_delay
before insert or update on public.daily_task_cycles
for each row execute function public.enforce_daily_task_registration_delay();

create or replace function public.get_daily_task_cycle()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cycle public.daily_task_cycles%rowtype;
  v_cycle_reset boolean := false;
  v_registered_at timestamptz;
  v_available_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authenticated user is required';
  end if;

  select u.created_at, u.created_at + interval '24 hours'
  into v_registered_at, v_available_at
  from auth.users u
  where u.id = v_user_id;

  if v_registered_at is null then
    raise exception 'User registration date is required';
  end if;

  select * into v_cycle
  from public.daily_task_cycles
  where user_id = v_user_id;

  if not found then
    return jsonb_build_object(
      'cycle_day', 0,
      'completed_tasks', '[]'::jsonb,
      'remaining_tasks', 4,
      'deadline_at', null,
      'last_task_at', null,
      'last_completed_at', null,
      'cycle_reset', false,
      'registered_at', v_registered_at,
      'tasks_available_at', v_available_at,
      'tasks_available', now() >= v_available_at
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
    'cycle_reset', v_cycle_reset,
    'registered_at', v_registered_at,
    'tasks_available_at', v_available_at,
    'tasks_available', now() >= v_available_at
  );
end;
$$;

revoke all on function public.get_daily_task_cycle() from public, anon;
grant execute on function public.get_daily_task_cycle() to authenticated;
