CREATE OR REPLACE FUNCTION public.complete_daily_tasks(p_task_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_is_business_day boolean := extract(isodow from now() at time zone 'America/Mexico_City') between 1 and 5;
begin
  if v_user_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if extract(isodow from now() at time zone 'America/Mexico_City') not between 1 and 5 then
    raise exception 'Las tareas de los nodos solo están disponibles de lunes a viernes (hora de Santo Domingo).' using errcode = 'P0001';
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
    v_cycle.deadline_at := bitnode_private.next_business_task_deadline(now() + interval '24 hours');
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
             'completed',
             now()
      from public.profiles p where p.id = v_user_id;

      v_rewards := v_rewards || jsonb_build_array(jsonb_build_object(
        'contract_id', v_contract.id, 'plan_id', v_contract.plan_id,
        'plan_name', v_contract.plan_name, 'capital', v_contract.amount,
        'rate', v_rate, 'rate_percent', round(v_rate * 100, 4),
        'reward', v_reward,
        'status', 'completed',
        'transaction_id', v_transaction_id
      ));

      v_total_available := v_total_available + v_reward;
      if v_contract.duration_days is not null then
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
      deadline_at = bitnode_private.next_business_task_deadline(now() + interval '24 hours'),
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
    'deadline_at', bitnode_private.next_business_task_deadline(now() + interval '24 hours')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.choose_finite_node_capital(p_user_id uuid, p_contract_id text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_contract public.contracts%rowtype;
  v_plan public.plans%rowtype;
  v_username text;
  v_wallet text;
  v_available jsonb;
  v_amount numeric(18,2);
  v_fee numeric(18,2);
  v_new_id text;
begin
  if p_action not in ('claim','reinvest') or p_contract_id is null or p_user_id is null then
    raise exception 'Elección de capital inválida.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = p_user_id for no key update;
  if not found then raise exception 'Perfil no encontrado.' using errcode = 'P0001'; end if;
  select * into v_contract from public.contracts where id = p_contract_id and user_id = p_user_id for update;
  if not found or v_contract.status <> 'completed' or v_contract.principal_returned_at is null then
    raise exception 'El nodo aún no ha concluido su ciclo.' using errcode = 'P0001';
  end if;
  select * into v_plan from public.plans where id = v_contract.plan_id;
  if not found or not coalesce(v_plan.duration_days in (7,14,21), false) or not coalesce(v_plan.principal_returned, false) then
    raise exception 'Este nodo no permite elegir el destino del capital.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.finite_node_capital_choices where contract_id = p_contract_id) then
    raise exception 'El capital de este nodo ya fue asignado.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.transactions where id = 'PRINCIPAL-' || p_contract_id
      and user_id = p_user_id and status = 'completed' and amount = v_contract.amount) then
    raise exception 'El capital del nodo aún no está acreditado.' using errcode = 'P0001';
  end if;
  if v_contract.amount <> round(v_contract.amount, 2) then
    raise exception 'El capital debe tener hasta dos decimales.' using errcode = 'P0001';
  end if;
  v_amount := v_contract.amount;
  v_available := public.get_withdrawal_availability(p_user_id, now());
  if (v_available->>'unrestricted')::numeric < v_amount then
    raise exception 'El capital disponible no alcanza para esta elección.' using errcode = 'P0001';
  end if;
  select username into v_username from public.profiles where id = p_user_id;
  if p_action = 'claim' then
    if exists (select 1 from public.transactions where user_id = p_user_id and type = 'withdraw'
      and withdrawal_day = (now() at time zone 'America/Mexico_City')::date) then
      raise exception 'Solo puedes solicitar 1 retiro por día (hora de Ciudad de México).' using errcode = 'P0001';
    end if;
    select raw_app_meta_data->>'withdrawal_wallet_bep20' into v_wallet from auth.users where id = p_user_id;
    if v_wallet is null or v_wallet !~ '^0x[a-fA-F0-9]{40}$' then
      raise exception 'Guarda y verifica tu wallet BEP20 en Perfil antes de reclamar.' using errcode = 'P0001';
    end if;
    v_fee := round(greatest(1, v_amount * 0.05), 2);
    if v_amount <= v_fee then raise exception 'El capital no cubre la comisión de retiro.' using errcode = 'P0001'; end if;
    insert into public.finite_node_capital_choices(contract_id,user_id,action,status,amount,fee,net_amount,wallet,payable_at,claim_day)
    values (p_contract_id,p_user_id,'claim','pending',v_amount,v_fee,v_amount-v_fee,v_wallet,now()+interval '24 hours',
      (now() at time zone 'America/Mexico_City')::date);
    insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
    values ('CAPITAL-RESERVE-' || p_contract_id,p_user_id,v_username,'deposit',
      'Capital reservado para retiro - ' || v_plan.name,-v_amount,'completed','finite_capital_reservation');
    return jsonb_build_object('status','pending','contract_id',p_contract_id,'payable_at',
      (select payable_at from public.finite_node_capital_choices where contract_id = p_contract_id));
  end if;
  if not v_plan.active then raise exception 'Este plan ya no admite reinversiones.' using errcode = 'P0001'; end if;
  v_new_id := 'REINVEST-' || p_contract_id;
  insert into public.contracts(id,user_id,plan_id,amount,status,starts_at,ends_at)
  values (v_new_id,p_user_id,v_plan.id,v_amount,'active',now(),now()+make_interval(days => v_plan.duration_days));
  insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
  values (v_new_id,p_user_id,v_username,'contract','Reinversión - ' || v_plan.name,-v_amount,'completed','finite_capital_reinvested');
  insert into public.finite_node_capital_choices(contract_id,user_id,action,status,amount,net_amount,new_contract_id)
  values (p_contract_id,p_user_id,'reinvest','reinvested',v_amount,v_amount,v_new_id);
  return jsonb_build_object('status','reinvested','contract_id',p_contract_id,'new_contract_id',v_new_id);
end;
$function$;

CREATE OR REPLACE FUNCTION bitnode_private.unspent_finite_node_roi(p_user_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select greatest(coalesce((select sum(t.amount) from public.transactions t
    join public.contract_cycle_rewards r on r.transaction_id = t.id
    join public.contracts c on c.id = r.contract_id
    join public.plans p on p.id = c.plan_id
    where t.user_id = p_user_id and t.status = 'completed' and t.type = 'yield'
      and p.duration_days in (7,14,21)),0)
    + coalesce((select sum(d.amount) from public.transactions d
      join public.contract_cycle_rewards r on d.provider_status = 'cycle_reset:' || r.transaction_id
      join public.contracts c on c.id = r.contract_id
      join public.plans p on p.id = c.plan_id
      where d.user_id = p_user_id and r.user_id = p_user_id and d.type = 'yield'
        and d.id = 'YIELD-RESET-' || r.id::text and d.status = 'completed'
        and p.duration_days in (7,14,21)),0)
    - coalesce((select sum(t.node_roi_spent) from public.transactions t
      where t.user_id = p_user_id and t.node_roi_spent > 0
        and ((t.type = 'withdraw' and t.status in ('pending','approved','completed'))
          or (t.type = 'contract' and t.status = 'completed'))),0),0);
$function$;

CREATE OR REPLACE FUNCTION bitnode_private.withdrawal_source_buckets(p_user_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with credited as (
  select
    coalesce(sum(t.amount) filter (
      where l.commission_type = 'direct'
    ), 0) as direct_total,
    coalesce(sum(t.amount) filter (
      where l.commission_type = 'direct'
        and l.created_at > p_at - interval '24 hours'
    ), 0) as direct_immature,
    min(l.created_at + interval '24 hours') filter (
      where l.commission_type = 'direct'
        and l.created_at > p_at - interval '24 hours'
    ) as next_direct_at,
    coalesce(sum(t.amount) filter (
      where l.commission_type = 'binary'
        or (
          l.id is null
          and (
            lower(t.label) like '%rango%'
            or lower(t.label) like '%rank%'
          )
        )
    ), 0) as weekly_total,
    coalesce(sum(t.amount) filter (
      where t.id like 'YIELD-%'
        and t.type = 'yield'
        and not exists (
          select 1
          from public.contract_cycle_rewards r
          join public.contracts c on c.id = r.contract_id
          join public.plans p on p.id = c.plan_id
          where r.transaction_id = t.id
            and p.duration_days in (7,14,21)
        )
    ), 0) as daily_node_roi
  from public.transactions t
  left join public.commission_ledger l
    on t.id = 'COMMISSION-' || l.id::text
   and l.beneficiary_id = p_user_id
   and l.status = 'credited'
  where t.user_id = p_user_id
    and t.status = 'completed'
    and t.amount > 0
), spent as (
  select
    coalesce(sum(t.direct_commission_spent),0) as direct_spent,
    coalesce(sum(t.weekly_bonus_spent),0) as weekly_spent
  from public.transactions t
  where t.user_id = p_user_id
    and (
      (t.type = 'withdraw' and t.status in (
        'pending','approved','completed'
      ))
      or (t.type = 'contract' and t.status = 'completed')
    )
), balance as (
  select coalesce(sum(t.amount) filter (
    where t.status = 'completed'
      or (
        t.type = 'withdraw'
        and t.status in ('pending','approved')
      )
  ), 0) as total
  from public.transactions t
  where t.user_id = p_user_id
), buckets as (
  select
    greatest(
      credited.direct_total - spent.direct_spent, 0
    ) as direct_unspent,
    credited.direct_immature,
    credited.next_direct_at,
    greatest(
      credited.weekly_total - spent.weekly_spent, 0
    ) as weekly_unspent,
    bitnode_private.unspent_finite_node_roi(p_user_id)
      as finite_roi_unspent,
    credited.daily_node_roi,
    balance.total
  from credited
  cross join spent
  cross join balance
)
select jsonb_build_object(
  'directUnspent', direct_unspent,
  'directImmature', least(direct_immature, direct_unspent),
  'directAvailable',
    greatest(direct_unspent - direct_immature, 0),
  'nextDirectAvailableAt', next_direct_at,
  'weeklyBonusUnspent', weekly_unspent,
  'finiteNodeRoiUnspent', finite_roi_unspent,
  'dailyNodeRoiCredited', daily_node_roi,
  'unrestricted',
    greatest(
      total - direct_unspent
            - weekly_unspent
            - finite_roi_unspent,
      0
    ),
  'balance', total
)
from buckets;
$function$;

CREATE OR REPLACE FUNCTION public.get_withdrawal_availability(p_user_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_sources jsonb;
  v_local timestamp;
  v_start timestamp;
  v_next_start timestamp;
  v_window_open boolean;
  v_direct numeric;
  v_weekly numeric;
  v_roi numeric;
  v_unrestricted numeric;
  v_total numeric;
begin
  if p_user_id is null or p_at is null then
    raise exception 'Usuario y fecha requeridos.';
  end if;

  v_sources :=
    bitnode_private.withdrawal_source_buckets(p_user_id, p_at);
  v_local := p_at at time zone 'America/Mexico_City';

  v_start := date_trunc('day', v_local)
    + (
      (3 - extract(isodow from v_local)::integer + 7) % 7
    ) * interval '1 day'
    + interval '8 hours';

  v_window_open :=
    v_local >= v_start
    and v_local < v_start + interval '7 hours';

  v_next_start :=
    case
      when v_local >= v_start + interval '7 hours'
        then v_start + interval '7 days'
      else v_start
    end;

  v_direct := (v_sources->>'directAvailable')::numeric;
  v_weekly := (v_sources->>'weeklyBonusUnspent')::numeric;
  v_roi := (v_sources->>'finiteNodeRoiUnspent')::numeric;
  v_unrestricted := (v_sources->>'unrestricted')::numeric;
  v_total := (v_sources->>'balance')::numeric;

  return v_sources || jsonb_build_object(
    'withdrawableBalance',
      least(
        greatest(v_total,0),
        v_unrestricted + v_direct
          + case
              when v_window_open then v_weekly + v_roi
              else 0
            end
      ),
    'lockedDirect',
      (v_sources->>'directImmature')::numeric,
    'lockedWednesday',
      case when v_window_open then 0 else v_weekly end,
    'lockedNodeRoi',
      case when v_window_open then 0 else v_roi end,
    'weeklyBonusAvailable',
      case when v_window_open then v_weekly else 0 end,
    'finiteNodeRoiAvailable',
      case when v_window_open then v_roi else 0 end,
    'weeklyWindowOpen', v_window_open,
    'nextWeeklyWindowAt',
      v_next_start at time zone 'America/Mexico_City',
    'weeklyWindowClosesAt',
      case
        when v_window_open then
          (v_start + interval '7 hours')
            at time zone 'America/Mexico_City'
        else null
      end,
    'scheduleTimezone', 'America/Mexico_City',
    'directMaturesAfterHours', 24
  );
end;
$function$;

CREATE OR REPLACE FUNCTION bitnode_private.attribute_withdrawal_debit(p_user_id uuid, p_amount numeric, p_is_contract boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_available jsonb :=
    public.get_withdrawal_availability(p_user_id, now());
  v_left numeric := p_amount;
  v_direct numeric := 0;
  v_bonus numeric := 0;
  v_roi numeric := 0;
  v_allow_weekly boolean :=
    p_is_contract
    or (v_available->>'weeklyWindowOpen')::boolean;
begin
  v_left :=
    greatest(
      v_left - least(
        v_left,
        (v_available->>'unrestricted')::numeric
      ),
      0
    );

  v_direct :=
    least(v_left, (v_available->>'directAvailable')::numeric);
  v_left := v_left - v_direct;

  if v_allow_weekly then
    v_bonus :=
      least(
        v_left,
        (v_available->>'weeklyBonusUnspent')::numeric
      );
    v_left := v_left - v_bonus;

    v_roi :=
      least(
        v_left,
        (v_available->>'finiteNodeRoiUnspent')::numeric
      );
    v_left := v_left - v_roi;
  end if;

  if v_left > 0 then
    raise exception
      'Fuentes disponibles insuficientes para el débito.'
      using errcode='P0001';
  end if;

  return jsonb_build_object(
    'direct',v_direct,
    'bonus',v_bonus,
    'roi',v_roi
  );
end;
$function$;
