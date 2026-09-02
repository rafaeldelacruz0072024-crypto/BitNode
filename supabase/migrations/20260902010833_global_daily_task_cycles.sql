-- BitNode: ciclos diarios globales por usuario, rendimiento por nodo y cierre seguro.
-- Las ganancias de planes 7/14/21 permanecen pendientes hasta completar el ciclo.
-- El capital nunca se revierte; solo se devuelve al terminar un plan finito.

create table if not exists public.daily_task_cycles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cycle_day integer not null default 0 check (cycle_day >= 0),
  completed_tasks text[] not null default array[]::text[],
  window_started_at timestamptz,
  deadline_at timestamptz,
  last_task_at timestamptz,
  last_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.contract_cycle_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id text not null references public.contracts(id) on delete cascade,
  reward_date date not null,
  rate numeric(8,6) not null check (rate >= 0 and rate <= 1),
  amount numeric(18,8) not null check (amount > 0),
  status text not null check (status in ('pending', 'completed', 'reversed')),
  transaction_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, reward_date)
);

create index if not exists contract_cycle_rewards_user_status_idx
  on public.contract_cycle_rewards(user_id, status, created_at desc);

alter table public.daily_task_cycles enable row level security;
alter table public.contract_cycle_rewards enable row level security;

drop policy if exists daily_task_cycles_select_own on public.daily_task_cycles;
create policy daily_task_cycles_select_own on public.daily_task_cycles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists contract_cycle_rewards_select_own on public.contract_cycle_rewards;
create policy contract_cycle_rewards_select_own on public.contract_cycle_rewards
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.daily_task_cycles, public.contract_cycle_rewards from anon;
grant select on public.daily_task_cycles, public.contract_cycle_rewards to authenticated;

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
  -- Solo se anulan ganancias provisionales. Las ganancias ya liberadas y el
  -- capital nunca se modifican mediante un reinicio.
  update public.transactions t
  set status = 'reversed'
  from public.contract_cycle_rewards r
  where r.user_id = p_user_id
    and r.status = 'pending'
    and r.transaction_id = t.id
    and t.status = 'pending';

  update public.contract_cycle_rewards
  set status = 'reversed', updated_at = now()
  where user_id = p_user_id and status = 'pending';

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

revoke all on function public.reset_daily_cycle_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.reset_daily_cycle_for_user(uuid, text) to service_role;

create or replace function public.get_daily_task_cycle()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cycle public.daily_task_cycles%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authenticated user is required';
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
      'last_completed_at', null
    );
  end if;

  return jsonb_build_object(
    'cycle_day', v_cycle.cycle_day,
    'completed_tasks', to_jsonb(v_cycle.completed_tasks),
    'remaining_tasks', greatest(0, 4 - cardinality(v_cycle.completed_tasks)),
    'deadline_at', v_cycle.deadline_at,
    'last_task_at', v_cycle.last_task_at,
    'last_completed_at', v_cycle.last_completed_at
  );
end;
$$;

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
  if (v_cycle.last_completed_at is not null and v_cycle.last_completed_at <= now() - interval '24 hours')
     or (v_cycle.window_started_at is not null
         and cardinality(v_cycle.completed_tasks) < 4
         and v_cycle.window_started_at <= now() - interval '24 hours') then
    perform public.reset_daily_cycle_for_user(v_user_id, 'missed_24h_window');
    select * into v_cycle from public.daily_task_cycles where user_id = v_user_id for update;
  end if;

  -- Las cuatro tareas del día anterior ya fueron cerradas: abrir una nueva ventana.
  if cardinality(v_cycle.completed_tasks) >= 4 then
    v_cycle.completed_tasks := array[]::text[];
    v_cycle.window_started_at := null;
    v_cycle.deadline_at := null;
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
      v_rate := round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6);
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
revoke all on function public.get_daily_task_cycle() from public, anon;
grant execute on function public.get_daily_task_cycle() to authenticated;

-- Desactiva la versión que permitía usar contratos distintos como anclas de pago.
revoke all on function public.complete_daily_task(text, text) from public, anon, authenticated;

-- Los planes finitos se miden por días de ciclo completados, no por calendario.
-- Evita que un incumplimiento reduzca injustamente su duración contratada.
update public.contracts c
set ends_at = null
from public.plans p
where p.id = c.plan_id
  and p.duration_days is not null
  and c.status = 'active';
