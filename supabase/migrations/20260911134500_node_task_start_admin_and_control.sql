-- Start the first daily-task window 24 hours after the first node purchase,
-- retain an administrative reset ledger, and authorize the requested operator.

do $grant_admin$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'luis-nug1943@outlook.com' limit 1;
  if v_user_id is null then
    raise exception 'Admin user luis-nug1943@outlook.com was not found';
  end if;
  update public.profiles set role = 'admin', updated_at = now() where id = v_user_id;
  if not found then
    raise exception 'Profile for luis-nug1943@outlook.com was not found';
  end if;
end;
$grant_admin$;

create table if not exists public.node_task_reset_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id text not null references public.contracts(id) on delete cascade,
  reason text not null,
  cycle_day_before integer not null default 0,
  completed_tasks_before text[] not null default array[]::text[],
  reset_at timestamptz not null default now()
);
create index if not exists node_task_reset_log_reset_idx on public.node_task_reset_log(reset_at desc);
create index if not exists node_task_reset_log_contract_idx on public.node_task_reset_log(contract_id, reset_at desc);
alter table public.node_task_reset_log enable row level security;
revoke all on public.node_task_reset_log from public, anon, authenticated;
grant select, insert on public.node_task_reset_log to service_role;

create or replace function bitnode_private.log_daily_node_reset()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cycle_day = 0
     and cardinality(new.completed_tasks) = 0
     and (old.cycle_day > 0 or cardinality(old.completed_tasks) > 0 or old.window_started_at is not null) then
    insert into public.node_task_reset_log(user_id, contract_id, reason, cycle_day_before, completed_tasks_before)
    select old.user_id, c.id, 'missed_24h_window', old.cycle_day, old.completed_tasks
    from public.contracts c
    where c.user_id = old.user_id and c.status = 'active';
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.log_daily_node_reset() from public, anon, authenticated;
drop trigger if exists log_daily_node_reset on public.daily_task_cycles;
create trigger log_daily_node_reset before update on public.daily_task_cycles
for each row execute function bitnode_private.log_daily_node_reset();

create or replace function public.enforce_daily_task_registration_delay()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first_node_at timestamptz;
  v_available_at timestamptz;
begin
  select min(c.created_at) into v_first_node_at
  from public.contracts c
  where c.user_id = new.user_id and c.status in ('active', 'completed', 'expired');
  if v_first_node_at is null then
    raise exception 'Debes comprar un nodo antes de iniciar las tareas diarias';
  end if;
  v_available_at := v_first_node_at + interval '24 hours';
  if now() < v_available_at then
    raise exception 'Las tareas se habilitan 24 horas después de la primera compra del nodo. Disponibles desde %', v_available_at;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_daily_task_registration_delay() from public, anon, authenticated;

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
  v_first_node_at timestamptz;
  v_available_at timestamptz;
begin
  if v_user_id is null then raise exception 'Authenticated user is required'; end if;
  select min(c.created_at) into v_first_node_at
  from public.contracts c
  where c.user_id = v_user_id and c.status in ('active', 'completed', 'expired');
  v_available_at := case when v_first_node_at is null then null else v_first_node_at + interval '24 hours' end;

  select * into v_cycle from public.daily_task_cycles where user_id = v_user_id;
  if not found then
    return jsonb_build_object(
      'cycle_day', 0, 'completed_tasks', '[]'::jsonb, 'remaining_tasks', 4,
      'deadline_at', null, 'last_task_at', null, 'last_completed_at', null,
      'cycle_reset', false, 'registered_at', v_first_node_at,
      'first_node_purchased_at', v_first_node_at, 'tasks_available_at', v_available_at,
      'tasks_available', v_available_at is not null and now() >= v_available_at
    );
  end if;

  if (v_cycle.last_completed_at is not null and v_cycle.last_completed_at <= now() - interval '24 hours')
     or (v_cycle.window_started_at is not null and cardinality(v_cycle.completed_tasks) < 4
         and coalesce(v_cycle.deadline_at, v_cycle.window_started_at + interval '24 hours') <= now()) then
    perform public.reset_daily_cycle_for_user(v_user_id, 'missed_24h_window');
    v_cycle_reset := true;
    select * into v_cycle from public.daily_task_cycles where user_id = v_user_id;
  end if;

  return jsonb_build_object(
    'cycle_day', v_cycle.cycle_day, 'completed_tasks', to_jsonb(v_cycle.completed_tasks),
    'remaining_tasks', greatest(0, 4 - cardinality(v_cycle.completed_tasks)),
    'deadline_at', v_cycle.deadline_at, 'last_task_at', v_cycle.last_task_at,
    'last_completed_at', v_cycle.last_completed_at, 'cycle_reset', v_cycle_reset,
    'registered_at', v_first_node_at, 'first_node_purchased_at', v_first_node_at,
    'tasks_available_at', v_available_at,
    'tasks_available', v_available_at is not null and now() >= v_available_at
  );
end;
$$;
revoke all on function public.get_daily_task_cycle() from public, anon;
grant execute on function public.get_daily_task_cycle() to authenticated;

do $verify$
begin
  if not exists (
    select 1 from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = 'luis-nug1943@outlook.com' and p.role = 'admin'
  ) then raise exception 'Requested administrator role was not applied'; end if;
end;
$verify$;
