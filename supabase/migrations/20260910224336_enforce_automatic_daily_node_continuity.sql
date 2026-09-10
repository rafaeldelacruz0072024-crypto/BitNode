-- Enforce one continuous 24-hour task window per active user. A missed window
-- resets node days and every generated yield still associated with an active
-- node. Contract capital and principal-return transactions are never touched.

create extension if not exists pg_cron;

create schema if not exists bitnode_private;
revoke all on schema bitnode_private from public, anon, authenticated;

-- Declare the final reset function directly so this migration is independent
-- of formatting and earlier deployed revisions of the function.
create or replace function public.reset_daily_cycle_for_user(
  p_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1
  from public.daily_task_cycles
  where user_id = p_user_id
  for update;

  if p_reason = 'missed_24h_window' then
    insert into public.user_notifications(user_id, kind)
    select p_user_id, 'cycle_reset'
    from public.daily_task_cycles
    where user_id = p_user_id
      and (
        cycle_day > 0
        or cardinality(completed_tasks) > 0
        or window_started_at is not null
        or last_completed_at is not null
      );
  end if;

  -- La ruptura de continuidad anula el rendimiento generado por nodos activos.
  -- El capital invertido y sus movimientos de principal nunca se modifican.
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

  update public.contract_cycle_rewards r
  set status = 'reversed', updated_at = now()
  from public.contracts c
  where r.user_id = p_user_id
    and c.id = r.contract_id
    and c.user_id = p_user_id
    and c.status = 'active'
    and r.status in ('pending', 'completed');

  update public.daily_task_cycles
  set cycle_day = 0,
      completed_tasks = array[]::text[],
      window_started_at = null,
      deadline_at = null,
      last_task_at = now(),
      last_completed_at = null,
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

revoke all on function public.reset_daily_cycle_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reset_daily_cycle_for_user(uuid, text) to service_role;

-- Install the canonical task RPC directly. This preserves the monthly ROI
-- control while enforcing one completed task window per 24-hour period.
create or replace function public.complete_daily_tasks(p_task_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cycle public.daily_task_cycles%rowtype;
  v_contract record;
  v_plan public.plans%rowtype;
  v_completed text[];
  v_rate numeric(8,6);
  v_reward numeric(18,8);
  v_reward_id uuid;
  v_transaction_id text;
  v_total_available numeric(18,8) := 0;
  v_total_pending numeric(18,8) := 0;
  v_total_principal numeric(18,8) := 0;
  v_effective_days integer;
  v_rewards jsonb := '[]'::jsonb;
  v_settlements jsonb := '[]'::jsonb;
  v_allowed_tasks constant text[] := array[
    'sync_node', 'validate_block', 'audit_mempool', 'sign_checkpoint'
  ];
  v_is_business_day boolean := extract(isodow from now()) between 1 and 5;
begin
  if v_user_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if not (p_task_key = any(v_allowed_tasks)) then
    raise exception 'Invalid daily task';
  end if;
  if not exists (
    select 1 from public.contracts c
    join public.plans p on p.id = c.plan_id
    where c.user_id = v_user_id and c.status = 'active' and p.active
  ) then
    raise exception 'At least one active node is required';
  end if;

  insert into public.daily_task_cycles(user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select * into v_cycle
  from public.daily_task_cycles
  where user_id = v_user_id
  for update;

  -- Si el usuario dejó pasar 24 horas desde el último día acreditado o no
  -- terminó una ventana iniciada, se anulan únicamente ganancias pendientes.
  if v_cycle.window_started_at is not null
     and cardinality(v_cycle.completed_tasks) < 4
     and coalesce(v_cycle.deadline_at, v_cycle.window_started_at + interval '24 hours') <= now() then
    perform public.reset_daily_cycle_for_user(v_user_id, 'missed_24h_window');
    select * into v_cycle from public.daily_task_cycles where user_id = v_user_id for update;
  end if;

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

  v_completed := coalesce(v_cycle.completed_tasks, array[]::text[]);
  if p_task_key = any(v_completed) then
    return jsonb_build_object(
      'status', 'already_completed',
      'cycle_day', v_cycle.cycle_day,
      'completed_tasks', to_jsonb(v_completed),
      'remaining_tasks', greatest(0, 4 - cardinality(v_completed)),
      'credited', false,
      'deadline_at', v_cycle.deadline_at
    );
  end if;

  if v_cycle.window_started_at is null then
    v_cycle.window_started_at := now();
    v_cycle.deadline_at := now() + interval '24 hours';
  end if;

  v_completed := array_append(v_completed, p_task_key);
  update public.daily_task_cycles
  set completed_tasks = v_completed,
      window_started_at = v_cycle.window_started_at,
      deadline_at = v_cycle.deadline_at,
      last_task_at = now(),
      updated_at = now()
  where user_id = v_user_id;

  if cardinality(v_completed) < 4 then
    return jsonb_build_object(
      'status', 'task_completed',
      'cycle_day', v_cycle.cycle_day,
      'completed_tasks', to_jsonb(v_completed),
      'remaining_tasks', 4 - cardinality(v_completed),
      'credited', false,
      'deadline_at', v_cycle.deadline_at
    );
  end if;

  -- Una cuarta tarea liquida todos los nodos activos, una sola vez por nodo/día.
  if v_is_business_day then
    for v_contract in
      select c.id, c.amount, c.plan_id, p.name as plan_name, p.rate_min, p.rate_max,
             p.duration_days, p.principal_returned
      from public.contracts c
      join public.plans p on p.id = c.plan_id
      where c.user_id = v_user_id and c.status = 'active' and p.active
      order by c.created_at
      for update of c
    loop
      v_rate := round(coalesce(bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date), (v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric), 6);
      if v_rate <= 0 then continue; end if;
      v_reward := round((v_contract.amount * v_rate)::numeric, 8);
      v_transaction_id := 'YIELD-' || replace(gen_random_uuid()::text, '-', '');

      insert into public.contract_cycle_rewards(
        user_id, contract_id, reward_date, rate, amount, status, transaction_id
      ) values (
        v_user_id, v_contract.id, current_date, v_rate, v_reward,
        case when v_contract.duration_days is null then 'completed' else 'pending' end,
        v_transaction_id
      ) on conflict (contract_id, reward_date) do nothing
      returning id into v_reward_id;

      if v_reward_id is null then
        continue;
      end if;

      insert into public.transactions(
        id, user_id, username, type, label, amount, status, created_at
      )
      select v_transaction_id, v_user_id, p.username, 'yield',
             'Pasivo diario - ' || v_contract.plan_name || ' · ROI ' || trim(to_char(v_rate * 100, 'FM990.0000')) || '%',
             v_reward,
             case when v_contract.duration_days is null then 'completed' else 'pending' end,
             now()
      from public.profiles p where p.id = v_user_id;

      v_rewards := v_rewards || jsonb_build_array(jsonb_build_object(
        'contract_id', v_contract.id, 'plan_id', v_contract.plan_id,
        'plan_name', v_contract.plan_name, 'capital', v_contract.amount,
        'rate', v_rate, 'rate_percent', round(v_rate * 100, 4),
        'reward', v_reward,
        'status', case when v_contract.duration_days is null then 'completed' else 'pending' end,
        'transaction_id', v_transaction_id
      ));

      if v_contract.duration_days is null then
        v_total_available := v_total_available + v_reward;
      else
        v_total_pending := v_total_pending + v_reward;
        select count(*) into v_effective_days
        from public.contract_cycle_rewards
        where contract_id = v_contract.id and status = 'pending';

        if v_effective_days >= v_contract.duration_days then
          update public.transactions t set status = 'completed'
          from public.contract_cycle_rewards r
          where r.contract_id = v_contract.id and r.status = 'pending'
            and r.transaction_id = t.id and t.status = 'pending';
          update public.contract_cycle_rewards set status = 'completed', updated_at = now()
          where contract_id = v_contract.id and status = 'pending';

          if v_contract.principal_returned then
            insert into public.transactions(id, user_id, username, type, label, amount, status, created_at)
            select 'PRINCIPAL-' || v_contract.id, v_user_id, p.username, 'deposit',
                   'Capital devuelto - ' || v_contract.plan_name, v_contract.amount, 'completed', now()
            from public.profiles p where p.id = v_user_id
            on conflict (id) do nothing;
            v_total_principal := v_total_principal + v_contract.amount;
          end if;

          update public.contracts
          set status = 'completed', principal_returned_at = case when v_contract.principal_returned then now() else null end,
              ends_at = now()
          where id = v_contract.id and status = 'active';
          v_settlements := v_settlements || jsonb_build_array(jsonb_build_object(
            'contract_id', v_contract.id, 'plan_name', v_contract.plan_name,
            'days_completed', v_effective_days, 'principal_returned', v_contract.principal_returned,
            'principal_amount', case when v_contract.principal_returned then v_contract.amount else 0 end
          ));
        end if;
      end if;
    end loop;
  end if;

  update public.daily_task_cycles
  set cycle_day = v_cycle.cycle_day + 1,
      completed_tasks = v_completed,
      last_task_at = now(),
      last_completed_at = now(),
      deadline_at = now() + interval '24 hours',
      updated_at = now()
  where user_id = v_user_id;

  return jsonb_build_object(
    'status', 'credited',
    'cycle_day', v_cycle.cycle_day + 1,
    'completed_tasks', to_jsonb(v_completed),
    'remaining_tasks', 0,
    'credited', v_total_available > 0 or v_total_principal > 0,
    'business_day', v_is_business_day,
    'available_reward', v_total_available,
    'pending_reward', v_total_pending,
    'principal_returned', v_total_principal,
    'rewards', v_rewards,
    'settlements', v_settlements,
    'deadline_at', now() + interval '24 hours'
  );
end;
$$;

revoke all on function public.complete_daily_tasks(text) from public, anon;
grant execute on function public.complete_daily_tasks(text) to authenticated;

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
