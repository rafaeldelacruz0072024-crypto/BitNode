-- Direct commission: 24-hour maturity, independent of the weekly window.
-- Binary/rank and finite-node ROI: Wednesday 08:00-15:00 Mexico City.
-- Flexible daily-node ROI stays in the unrestricted balance.
alter table public.transactions add column if not exists direct_commission_spent numeric(18,2) not null default 0;
alter table public.transactions add column if not exists weekly_bonus_spent numeric(18,2) not null default 0;
alter table public.transactions drop constraint if exists transactions_withdrawal_source_spent_check;
alter table public.transactions add constraint transactions_withdrawal_source_spent_check
  check (direct_commission_spent >= 0 and weekly_bonus_spent >= 0
    and direct_commission_spent + weekly_bonus_spent + node_roi_spent <= greatest(-amount, 0));

-- Turn on the untouched installation default; retain any admin-made hold.
update public.platform_settings
set value = value || jsonb_build_object('enabled', true, 'mode', 'scheduled_mexico'), updated_at = now()
where key = 'withdrawal_window' and value->>'updated_by' is null;

create or replace function bitnode_private.withdrawal_source_buckets(p_user_id uuid, p_at timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
with credited as (
  select
    coalesce(sum(t.amount) filter (where l.commission_type = 'direct'), 0) as direct_total,
    coalesce(sum(t.amount) filter (where l.commission_type = 'direct'
      and l.created_at > p_at - interval '24 hours'), 0) as direct_immature,
    min(l.created_at + interval '24 hours') filter (where l.commission_type = 'direct'
      and l.created_at > p_at - interval '24 hours') as next_direct_at,
    coalesce(sum(t.amount) filter (where l.commission_type = 'binary'
      or (l.id is null and (lower(t.label) like '%rango%' or lower(t.label) like '%rank%'))), 0) as weekly_total,
    coalesce(sum(t.amount) filter (where t.id like 'YIELD-%' and t.type = 'yield'
      and not exists (select 1 from public.contract_cycle_rewards r
        join public.contracts c on c.id = r.contract_id
        join public.plans p on p.id = c.plan_id
        where r.transaction_id = t.id and p.duration_days in (7,14,21))), 0) as daily_node_roi
  from public.transactions t
  left join public.commission_ledger l on t.id = 'COMMISSION-' || l.id::text
    and l.beneficiary_id = p_user_id and l.status = 'credited'
  where t.user_id = p_user_id and t.status = 'completed' and t.amount > 0
), spent as (
  select coalesce(sum(t.direct_commission_spent),0) as direct_spent,
    coalesce(sum(t.weekly_bonus_spent),0) as weekly_spent
  from public.transactions t where t.user_id = p_user_id
    and ((t.type = 'withdraw' and t.status in ('pending','approved','completed'))
      or (t.type = 'contract' and t.status = 'completed'))
), balance as (
  select coalesce(sum(t.amount) filter (where t.status = 'completed'
    or (t.type = 'withdraw' and t.status in ('pending','approved'))), 0) as total
  from public.transactions t where t.user_id = p_user_id
), buckets as (
  select greatest(credited.direct_total - spent.direct_spent, 0) as direct_unspent,
    credited.direct_immature, credited.next_direct_at,
    greatest(credited.weekly_total - spent.weekly_spent, 0) as weekly_unspent,
    bitnode_private.unspent_finite_node_roi(p_user_id) as finite_roi_unspent,
    credited.daily_node_roi, balance.total
  from credited cross join spent cross join balance
)
select jsonb_build_object(
  'directUnspent', direct_unspent,
  'directImmature', least(direct_immature, direct_unspent),
  'directAvailable', greatest(direct_unspent - direct_immature, 0),
  'nextDirectAvailableAt', next_direct_at,
  'weeklyBonusUnspent', weekly_unspent,
  'finiteNodeRoiUnspent', finite_roi_unspent,
  'dailyNodeRoiCredited', daily_node_roi,
  'unrestricted', greatest(total - direct_unspent - weekly_unspent - finite_roi_unspent, 0),
  'balance', total
) from buckets;
$$;
revoke all on function bitnode_private.withdrawal_source_buckets(uuid,timestamptz) from public, anon, authenticated;
grant execute on function bitnode_private.withdrawal_source_buckets(uuid,timestamptz) to service_role;

create or replace function public.get_withdrawal_availability(p_user_id uuid, p_at timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
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
  if p_user_id is null or p_at is null then raise exception 'Usuario y fecha requeridos.'; end if;
  v_sources := bitnode_private.withdrawal_source_buckets(p_user_id, p_at);
  v_local := p_at at time zone 'America/Mexico_City';
  v_start := date_trunc('day', v_local)
    + ((3 - extract(isodow from v_local)::integer + 7) % 7) * interval '1 day'
    + interval '8 hours';
  v_window_open := v_local >= v_start and v_local < v_start + interval '7 hours';
  v_next_start := case when v_local >= v_start + interval '7 hours'
    then v_start + interval '7 days' else v_start end;
  v_direct := (v_sources->>'directAvailable')::numeric;
  v_weekly := (v_sources->>'weeklyBonusUnspent')::numeric;
  v_roi := (v_sources->>'finiteNodeRoiUnspent')::numeric;
  v_unrestricted := (v_sources->>'unrestricted')::numeric;
  v_total := (v_sources->>'balance')::numeric;
  return v_sources || jsonb_build_object(
    'withdrawableBalance', least(greatest(v_total,0),
      v_unrestricted + v_direct + case when v_window_open then v_weekly + v_roi else 0 end),
    'lockedDirect', (v_sources->>'directImmature')::numeric,
    'lockedWednesday', case when v_window_open then 0 else v_weekly end,
    'lockedNodeRoi', case when v_window_open then 0 else v_roi end,
    'weeklyBonusAvailable', case when v_window_open then v_weekly else 0 end,
    'finiteNodeRoiAvailable', case when v_window_open then v_roi else 0 end,
    'weeklyWindowOpen', v_window_open,
    'nextWeeklyWindowAt', (v_next_start at time zone 'America/Mexico_City'),
    'weeklyWindowClosesAt', case when v_window_open
      then (v_start + interval '7 hours') at time zone 'America/Mexico_City' else null end,
    'scheduleTimezone', 'America/Mexico_City',
    'directMaturesAfterHours', 24
  );
end;
$$;
revoke all on function public.get_withdrawal_availability(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.get_withdrawal_availability(uuid,timestamptz) to service_role;

create or replace function public.validate_withdrawal_request(p_user_id uuid, p_amount numeric)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_available jsonb; v_used numeric; v_window jsonb;
begin
  if p_user_id is null or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount < 10 or p_amount > 1000 or p_amount <> round(p_amount,2) then
    raise exception 'El retiro debe estar entre 10 y 1000 USDT y tener hasta dos decimales.' using errcode='P0001';
  end if;
  select value into v_window from public.platform_settings where key = 'withdrawal_window';
  if coalesce(v_window->>'enabled','false') <> 'true' then
    raise exception 'La ventana global de retiros está cerrada por administración.' using errcode='P0001';
  end if;
  v_available := public.get_withdrawal_availability(p_user_id, now());
  if (v_available->>'balance')::numeric < p_amount then
    raise exception 'Saldo disponible insuficiente. Los retiros pendientes ya están reservados.' using errcode='P0001';
  end if;
  if (v_available->>'withdrawableBalance')::numeric < p_amount then
    if not (v_available->>'weeklyWindowOpen')::boolean
      and ((v_available->>'lockedWednesday')::numeric > 0 or (v_available->>'lockedNodeRoi')::numeric > 0) then
      raise exception 'Bonos binario/rango y ROI de nodos 7/14/21: miércoles de 8:00 a 15:00, hora de Ciudad de México.' using errcode='P0001';
    end if;
    if (v_available->>'lockedDirect')::numeric > 0 then
      raise exception 'La comisión directa se libera 24 horas después de acreditarse.' using errcode='P0001';
    end if;
    raise exception 'Saldo retirable insuficiente.' using errcode='P0001';
  end if;
  select coalesce(sum(abs(t.amount)),0) into v_used from public.transactions t
    where t.user_id = p_user_id and t.type = 'withdraw'
      and t.created_at >= now() - interval '24 hours';
  if v_used + p_amount > 1000 then
    raise exception 'Límite de 1000 USDT excedido dentro de las últimas 24 horas.' using errcode='P0001';
  end if;
  return v_available || jsonb_build_object('usedLast24Hours',v_used);
end;
$$;
revoke all on function public.validate_withdrawal_request(uuid,numeric) from public, anon, authenticated;
grant execute on function public.validate_withdrawal_request(uuid,numeric) to service_role;

-- Each debit records how much came from each source. Unrestricted funds are
-- used first; withdrawals cannot consume immature direct or weekly funds.
create or replace function bitnode_private.attribute_withdrawal_debit(
  p_user_id uuid, p_amount numeric, p_is_contract boolean
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_available jsonb := public.get_withdrawal_availability(p_user_id, now());
  v_left numeric := p_amount;
  v_direct numeric := 0;
  v_bonus numeric := 0;
  v_roi numeric := 0;
  v_allow_weekly boolean := p_is_contract or (v_available->>'weeklyWindowOpen')::boolean;
begin
  v_left := greatest(v_left - least(v_left, (v_available->>'unrestricted')::numeric), 0);
  v_direct := least(v_left, (v_available->>'directAvailable')::numeric);
  v_left := v_left - v_direct;
  if v_allow_weekly then
    v_bonus := least(v_left, (v_available->>'weeklyBonusUnspent')::numeric);
    v_left := v_left - v_bonus;
    v_roi := least(v_left, (v_available->>'finiteNodeRoiUnspent')::numeric);
    v_left := v_left - v_roi;
  end if;
  if v_left > 0 then raise exception 'Fuentes disponibles insuficientes para el débito.' using errcode='P0001'; end if;
  return jsonb_build_object('direct',v_direct,'bonus',v_bonus,'roi',v_roi);
end;
$$;
revoke all on function bitnode_private.attribute_withdrawal_debit(uuid,numeric,boolean) from public, anon, authenticated;
grant execute on function bitnode_private.attribute_withdrawal_debit(uuid,numeric,boolean) to service_role;

-- Keep the verified email challenge, wallet lock, reservation and balance
-- guard intact; replace only the source attribution in the installed trigger.
do $patch_guard$
declare
  v_old text := pg_get_functiondef('bitnode_private.guard_reserved_ledger()'::regprocedure);
  v_new text;
begin
  if position('new.node_roi_spent := case' in v_old) = 0
    or position('new.node_roi_spent := least(-new.amount' in v_old) = 0 then
    raise exception 'Unknown reserved-ledger guard; inspect before changing withdrawal buckets.';
  end if;
  v_new := replace(v_old, 'v_challenge public.email_security_challenges%rowtype;',
    'v_challenge public.email_security_challenges%rowtype; v_allocation jsonb;');
  v_new := replace(v_new,
    $old$    new.node_roi_spent := case when extract(isodow from now() at time zone 'America/Santo_Domingo') = 3
      then least(-new.amount, bitnode_private.unspent_finite_node_roi(new.user_id)) else 0 end;$old$,
    $new$    v_allocation := bitnode_private.attribute_withdrawal_debit(new.user_id, -new.amount, false);
    new.node_roi_spent := (v_allocation->>'roi')::numeric;
    new.direct_commission_spent := (v_allocation->>'direct')::numeric;
    new.weekly_bonus_spent := (v_allocation->>'bonus')::numeric;$new$);
  v_new := replace(v_new,
    $old$    new.node_roi_spent := least(-new.amount, bitnode_private.unspent_finite_node_roi(new.user_id));$old$,
    $new$    v_allocation := bitnode_private.attribute_withdrawal_debit(new.user_id, -new.amount, true);
    new.node_roi_spent := (v_allocation->>'roi')::numeric;
    new.direct_commission_spent := (v_allocation->>'direct')::numeric;
    new.weekly_bonus_spent := (v_allocation->>'bonus')::numeric;$new$);
  v_new := replace(v_new, 'new.node_roi_spent)',
    'new.node_roi_spent, new.direct_commission_spent, new.weekly_bonus_spent)');
  v_new := replace(v_new, 'old.node_roi_spent)',
    'old.node_roi_spent, old.direct_commission_spent, old.weekly_bonus_spent)');
  if v_new = v_old or position('v_allocation := bitnode_private.attribute_withdrawal_debit' in v_new) = 0
    or position($check$new.direct_commission_spent, new.weekly_bonus_spent)$check$ in v_new) = 0 then
    raise exception 'Reserved-ledger guard patch did not match.';
  end if;
  execute v_new;
end;
$patch_guard$;

notify pgrst, 'reload schema';
