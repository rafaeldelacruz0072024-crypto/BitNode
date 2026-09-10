-- Enforce one continuous 24-hour task window per active user. A missed window
-- resets node days and every generated yield still associated with an active
-- node. Contract capital and principal-return transactions are never touched.

create extension if not exists pg_cron;

create schema if not exists bitnode_private;
revoke all on schema bitnode_private from public, anon, authenticated;

-- Include completed yield from active open-ended nodes in a continuity reset.
-- This deliberately targets only transactions backed by contract_cycle_rewards;
-- deposits and principal movements cannot match this update.
do $patch_reset$
declare
  v_source text := pg_get_functiondef('public.reset_daily_cycle_for_user(uuid,text)'::regprocedure);
  v_old_comment text := $old$
  -- Solo se anulan ganancias provisionales. Las ganancias ya liberadas y el
  -- capital nunca se modifican mediante un reinicio.
$old$;
  v_new_comment text := $new$
  -- La ruptura de continuidad anula el rendimiento generado por nodos activos.
  -- El capital invertido y sus movimientos de principal nunca se modifican.
$new$;
  v_old_transactions text := $old$
  update public.transactions t
  set status = 'reversed'
  from public.contract_cycle_rewards r
  where r.user_id = p_user_id
    and r.status = 'pending'
    and r.transaction_id = t.id
    and t.status = 'pending';
$old$;
  v_new_transactions text := $new$
  update public.transactions t
  set status = 'reversed'
  from public.contract_cycle_rewards r
  join public.contracts c on c.id = r.contract_id
  where r.user_id = p_user_id
    and c.user_id = p_user_id
    and c.status = 'active'
    and r.status in ('pending', 'completed')
    and r.transaction_id = t.id
    and t.status in ('pending', 'completed');
$new$;
  v_old_rewards text := $old$
  update public.contract_cycle_rewards
  set status = 'reversed', updated_at = now()
  where user_id = p_user_id and status = 'pending';
$old$;
  v_new_rewards text := $new$
  update public.contract_cycle_rewards r
  set status = 'reversed', updated_at = now()
  from public.contracts c
  where r.user_id = p_user_id
    and c.id = r.contract_id
    and c.user_id = p_user_id
    and c.status = 'active'
    and r.status in ('pending', 'completed');
$new$;
begin
  if position(v_old_transactions in v_source) = 0
     or position(v_old_rewards in v_source) = 0 then
    raise exception 'Unexpected reset function; review before enabling automatic continuity';
  end if;

  execute replace(
    replace(
      replace(v_source, v_old_comment, v_new_comment),
      v_old_transactions,
      v_new_transactions
    ),
    v_old_rewards,
    v_new_rewards
  );
end;
$patch_reset$;

-- Prevent a second task window from being started before the current completed
-- window reaches its deadline. This is enforced in the database, not the UI.
do $patch_task_rpc$
declare
  v_source text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  v_old text := $old$
  -- Las cuatro tareas del día anterior ya fueron cerradas: abrir una nueva ventana.
  if cardinality(v_cycle.completed_tasks) >= 4 then
    v_cycle.completed_tasks := array[]::text[];
    v_cycle.window_started_at := null;
    v_cycle.deadline_at := null;
  end if;
$old$;
  v_new text := $new$
  -- Una jornada 4/4 permanece cerrada hasta que termine su ventana de 24 horas.
  if cardinality(v_cycle.completed_tasks) >= 4 then
    if v_cycle.deadline_at is null or v_cycle.deadline_at > now() then
      return jsonb_build_object(
        'status', 'day_already_completed',
        'cycle_day', v_cycle.cycle_day,
        'completed_tasks', to_jsonb(v_cycle.completed_tasks),
        'remaining_tasks', 0,
        'credited', false,
        'deadline_at', v_cycle.deadline_at
      );
    end if;

    v_cycle.completed_tasks := array[]::text[];
    v_cycle.window_started_at := v_cycle.deadline_at;
    v_cycle.deadline_at := v_cycle.deadline_at + interval '24 hours';

    update public.daily_task_cycles
    set completed_tasks = v_cycle.completed_tasks,
        window_started_at = v_cycle.window_started_at,
        deadline_at = v_cycle.deadline_at,
        updated_at = now()
    where user_id = v_user_id;
  end if;
$new$;
begin
  if position(v_old in v_source) = 0 then
    raise exception 'Unexpected complete_daily_tasks function; review continuity guard';
  end if;
  execute replace(v_source, v_old, v_new);
end;
$patch_task_rpc$;

create or replace function bitnode_private.enforce_daily_node_continuity()
returns jsonb
language plpgsql
security definer
set search_path = public, bitnode_private, pg_temp
as $$
declare
  v_cycle public.daily_task_cycles%rowtype;
  v_reset_count integer := 0;
  v_opened_count integer := 0;
  v_next_deadline timestamptz;
begin
  -- Avoid overlapping scheduler runs while still allowing user RPCs to finish.
  if not pg_try_advisory_xact_lock(hashtext('bitnode_daily_node_continuity')) then
    return jsonb_build_object('status', 'already_running');
  end if;

  for v_cycle in
    select cycle.*
    from public.daily_task_cycles cycle
    where cycle.window_started_at is not null
      and cycle.deadline_at is not null
      and cycle.deadline_at <= now()
    order by cycle.deadline_at, cycle.user_id
    for update skip locked
  loop
    if cardinality(v_cycle.completed_tasks) < 4 then
      perform public.reset_daily_cycle_for_user(v_cycle.user_id, 'missed_24h_window');
      v_reset_count := v_reset_count + 1;
      continue;
    end if;

    -- The completed period succeeded. Open the immediately following period.
    v_next_deadline := v_cycle.deadline_at + interval '24 hours';
    if v_next_deadline <= now() then
      -- The following full day also elapsed with no tasks, so continuity broke.
      perform public.reset_daily_cycle_for_user(v_cycle.user_id, 'missed_24h_window');
      v_reset_count := v_reset_count + 1;
    else
      update public.daily_task_cycles
      set completed_tasks = array[]::text[],
          window_started_at = v_cycle.deadline_at,
          deadline_at = v_next_deadline,
          updated_at = now()
      where user_id = v_cycle.user_id;
      v_opened_count := v_opened_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'completed',
    'reset_users', v_reset_count,
    'opened_windows', v_opened_count,
    'checked_at', now()
  );
end;
$$;

revoke all on function bitnode_private.enforce_daily_node_continuity()
  from public, anon, authenticated;

-- Idempotently replace the job. Supabase Cron records every run in
-- cron.job_run_details for operational verification.
select cron.unschedule(jobid)
from cron.job
where jobname = 'bitnode-daily-node-continuity';

select cron.schedule(
  'bitnode-daily-node-continuity',
  '*/5 * * * *',
  'select bitnode_private.enforce_daily_node_continuity();'
);

do $verification$
declare
  v_reset_source text := pg_get_functiondef('public.reset_daily_cycle_for_user(uuid,text)'::regprocedure);
  v_task_source text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
begin
  if position('r.status in (''pending'', ''completed'')' in v_reset_source) = 0
     or position('c.status = ''active''' in v_reset_source) = 0 then
    raise exception 'Generated-yield reset guard is not active';
  end if;

  if position('''status'', ''day_already_completed''' in v_task_source) = 0 then
    raise exception 'One-window-per-day task guard is not active';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'bitnode-daily-node-continuity'
      and active
  ) then
    raise exception 'Automatic continuity cron job is not active';
  end if;
end;
$verification$;
