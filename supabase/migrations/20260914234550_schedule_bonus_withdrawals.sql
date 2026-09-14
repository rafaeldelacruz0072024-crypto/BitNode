-- Withdrawal schedule for referral bonuses.
-- Direct commissions mature after 24 hours. Binary and rank bonuses are
-- withdrawable only on Wednesdays in America/Santo_Domingo.
-- Principal, deposits and node yields keep their existing availability.

create or replace function public.get_withdrawal_availability(
  p_user_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_total numeric := 0;
  v_locked_direct numeric := 0;
  v_locked_wednesday numeric := 0;
  v_is_wednesday boolean;
  v_next_direct_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'Usuario requerido.' using errcode = 'P0001';
  end if;

  v_is_wednesday := extract(isodow from p_at at time zone 'America/Santo_Domingo') = 3;

  select coalesce(sum(t.amount) filter (
    where t.status = 'completed'
       or (t.type = 'withdraw' and t.status in ('pending', 'approved'))
  ), 0)
  into v_total
  from public.transactions t
  where t.user_id = p_user_id;

  select
    coalesce(sum(l.amount) filter (
      where l.commission_type = 'direct'
        and l.created_at > p_at - interval '24 hours'
    ), 0),
    min(l.created_at + interval '24 hours') filter (
      where l.commission_type = 'direct'
        and l.created_at > p_at - interval '24 hours'
    )
  into v_locked_direct, v_next_direct_at
  from public.commission_ledger l
  join public.transactions t
    on t.id = 'COMMISSION-' || l.id::text
   and t.user_id = l.beneficiary_id
   and t.status = 'completed'
  where l.beneficiary_id = p_user_id
    and l.status = 'credited';

  if not v_is_wednesday then
    select coalesce(sum(t.amount), 0)
    into v_locked_wednesday
    from public.transactions t
    where t.user_id = p_user_id
      and t.status = 'completed'
      and t.amount > 0
      and (
        exists (
          select 1
          from public.commission_ledger l
          where l.id::text = replace(t.id, 'COMMISSION-', '')
            and l.beneficiary_id = p_user_id
            and l.status = 'credited'
            and l.commission_type = 'binary'
        )
        or lower(t.label) like '%rango%'
        or lower(t.label) like '%rank%'
      );
  end if;

  return jsonb_build_object(
    'balance', v_total,
    'withdrawableBalance', greatest(v_total - v_locked_direct - v_locked_wednesday, 0),
    'lockedDirect', v_locked_direct,
    'lockedWednesday', v_locked_wednesday,
    'directMaturesAfterHours', 24,
    'nextDirectAvailableAt', v_next_direct_at,
    'binaryAndRankWindowOpen', v_is_wednesday,
    'scheduleTimezone', 'America/Santo_Domingo'
  );
end;
$$;

revoke all on function public.get_withdrawal_availability(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_withdrawal_availability(uuid, timestamptz)
  to service_role;

create or replace function public.validate_withdrawal_request(p_user_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_availability jsonb;
  v_balance numeric;
  v_withdrawable numeric;
  v_locked_direct numeric;
  v_locked_wednesday numeric;
  v_used numeric;
begin
  if p_user_id is null or p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_amount < 10 or p_amount > 1000 or p_amount <> round(p_amount, 2) then
    raise exception 'El retiro debe estar entre 10 y 1000 USDT y tener hasta dos decimales.' using errcode = 'P0001';
  end if;

  v_availability := public.get_withdrawal_availability(p_user_id, now());
  v_balance := (v_availability ->> 'balance')::numeric;
  v_withdrawable := (v_availability ->> 'withdrawableBalance')::numeric;
  v_locked_direct := (v_availability ->> 'lockedDirect')::numeric;
  v_locked_wednesday := (v_availability ->> 'lockedWednesday')::numeric;

  if v_balance::text in ('NaN', 'Infinity', '-Infinity') or v_balance < p_amount then
    raise exception 'Saldo disponible insuficiente. Los retiros pendientes y aprobados ya están reservados.' using errcode = 'P0001';
  end if;
  if v_withdrawable < p_amount then
    if v_locked_direct > 0 and v_locked_wednesday > 0 then
      raise exception 'Parte del saldo está bloqueada: la comisión directa requiere 24 horas y los bonos binario/rango se retiran los miércoles.' using errcode = 'P0001';
    elsif v_locked_direct > 0 then
      raise exception 'La comisión directa estará disponible 24 horas después de acreditarse.' using errcode = 'P0001';
    else
      raise exception 'Los bonos binario y de rango solo se pueden retirar los miércoles, hora de Santo Domingo.' using errcode = 'P0001';
    end if;
  end if;

  select coalesce(sum(abs(t.amount)), 0)
  into v_used
  from public.transactions t
  where t.user_id = p_user_id
    and t.type = 'withdraw'
    and t.created_at >= now() - interval '24 hours';

  if v_used + p_amount > 1000 then
    raise exception 'Límite de 1000 USDT excedido dentro de las últimas 24 horas.' using errcode = 'P0001';
  end if;

  return v_availability || jsonb_build_object('usedLast24Hours', v_used);
end;
$$;

revoke all on function public.validate_withdrawal_request(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.validate_withdrawal_request(uuid, numeric)
  to service_role;

notify pgrst, 'reload schema';
