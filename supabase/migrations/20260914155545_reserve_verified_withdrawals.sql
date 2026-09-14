-- Reserve verified withdrawals in the ledger, including concurrent node purchases.
-- Existing transactions and the administrator's window setting are preserved.
create schema if not exists bitnode_private;
revoke all on schema bitnode_private from public, anon, authenticated;

alter table public.transactions drop constraint if exists transactions_status_check;
alter table public.transactions add constraint transactions_status_check
  check (status in ('pending', 'approved', 'completed', 'rejected', 'reversed', 'failed', 'credited', 'confirmed'));

alter table public.transactions add column if not exists email_challenge_id uuid
  references public.email_security_challenges(id);
create unique index if not exists transactions_email_challenge_unique
  on public.transactions(email_challenge_id) where email_challenge_id is not null;

create or replace function public.get_account_ledger_summary(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'balance', coalesce(sum(amount) filter (where status = 'completed'
      or (type = 'withdraw' and status in ('pending', 'approved'))), 0),
    'totalInvested', coalesce(-sum(amount) filter (where type = 'contract' and status = 'completed' and amount < 0), 0),
    'totalYield', coalesce(sum(amount) filter (where type = 'yield' and status = 'completed' and amount > 0), 0)
  ) from public.transactions where user_id = p_user_id;
$$;
revoke all on function public.get_account_ledger_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_account_ledger_summary(uuid) to service_role;

create or replace function public.validate_withdrawal_request(p_user_id uuid, p_amount numeric)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_balance numeric; v_used numeric; v_window jsonb;
begin
  if p_user_id is null or p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or p_amount < 10 or p_amount > 1000 or p_amount <> round(p_amount, 2) then
    raise exception 'El retiro debe estar entre 10 y 1000 USDT y tener hasta dos decimales.' using errcode = 'P0001';
  end if;
  select value into v_window from public.platform_settings where key = 'withdrawal_window';
  if coalesce(v_window->'enabled', 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'La ventana de retiros está cerrada temporalmente.' using errcode = 'P0001';
  end if;
  select (public.get_account_ledger_summary(p_user_id)->>'balance')::numeric into v_balance;
  if v_balance::text in ('NaN', 'Infinity', '-Infinity') or v_balance < p_amount then
    raise exception 'Saldo disponible insuficiente. Los retiros pendientes y aprobados ya están reservados.' using errcode = 'P0001';
  end if;
  select coalesce(sum(abs(amount)), 0) into v_used from public.transactions
    where user_id = p_user_id and type = 'withdraw'
      and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
  if v_used + p_amount > 1000 then
    raise exception 'Límite diario de 1000 USDT excedido.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('balance', v_balance, 'usedToday', v_used);
end;
$$;
revoke all on function public.validate_withdrawal_request(uuid,numeric) from public, anon, authenticated;
grant execute on function public.validate_withdrawal_request(uuid,numeric) to service_role;

create or replace function bitnode_private.guard_reserved_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old_impact numeric := 0; v_new_impact numeric := 0; v_balance numeric; v_challenge public.email_security_challenges%rowtype;
begin
  if new.amount is null or new.amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'El monto debe ser finito.';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then raise exception 'No se puede cambiar el titular del movimiento.'; end if;
    if old.status = 'completed' or (old.type = 'withdraw' and old.status in ('pending', 'approved')) then
      v_old_impact := old.amount;
    end if;
    if old.type = 'withdraw' or new.type = 'withdraw' then
      if (new.id, new.type, new.amount, new.network, new.wallet, new.fee, new.net_amount, new.email_challenge_id, new.created_at)
        is distinct from (old.id, old.type, old.amount, old.network, old.wallet, old.fee, old.net_amount, old.email_challenge_id, old.created_at) then
        raise exception 'Los datos de un retiro confirmado no se pueden modificar.';
      end if;
      if new.status is distinct from old.status and not (
        (old.status = 'pending' and new.status in ('approved', 'rejected')) or
        (old.status = 'approved' and new.status in ('completed', 'rejected'))
      ) then raise exception 'Transición de retiro no válida.'; end if;
    end if;
  end if;

  if new.status = 'completed' or (new.type = 'withdraw' and new.status in ('pending', 'approved')) then
    v_new_impact := new.amount;
  end if;
  -- Same row lock used by node activation; held until the outer transaction ends.
  -- Every ledger writer that affects a balance participates in this lock.
  if v_old_impact <> 0 or v_new_impact <> 0 then
    if new.user_id is null then raise exception 'Usuario requerido para el movimiento.'; end if;
    perform 1 from public.profiles where id = new.user_id for no key update;
    if not found then raise exception 'Perfil no encontrado.'; end if;
  end if;
  if tg_op = 'INSERT' and new.type = 'withdraw' then
    if new.status <> 'pending' or new.amount >= 0 or new.network is distinct from 'BNB Chain'
       or new.wallet is null or new.wallet !~ '^0x[a-fA-F0-9]{40}$' then
      raise exception 'Datos de retiro no válidos.';
    end if;
    select * into v_challenge from public.email_security_challenges where id = new.email_challenge_id;
    if not found or v_challenge.user_id is distinct from new.user_id or v_challenge.purpose <> 'withdrawal'
      or v_challenge.consumed_at is null
      or (v_challenge.payload->>'amount')::numeric is distinct from -new.amount
      or v_challenge.payload->>'network' is distinct from new.network
      or v_challenge.payload->>'wallet' is distinct from new.wallet then
      raise exception 'El retiro requiere confirmación por correo.';
    end if;
    -- A close-window operation cannot race past this final check.
    perform 1 from public.platform_settings where key = 'withdrawal_window' for share;
    perform public.validate_withdrawal_request(new.user_id, -new.amount);
    new.created_at := now();
    new.fee := round(greatest(1, -new.amount * 0.05), 2);
    new.net_amount := -new.amount - new.fee;
  end if;
  if v_new_impact < v_old_impact then
    select (public.get_account_ledger_summary(new.user_id)->>'balance')::numeric into v_balance;
    if v_balance::text in ('NaN', 'Infinity', '-Infinity') or v_balance + v_new_impact - v_old_impact < 0 then
      raise exception 'Saldo disponible insuficiente. Los retiros pendientes y aprobados ya están reservados.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.guard_reserved_ledger() from public, anon, authenticated;
drop trigger if exists guard_reserved_ledger on public.transactions;
create trigger guard_reserved_ledger before insert or update on public.transactions
  for each row execute function bitnode_private.guard_reserved_ledger();

-- Only the server can confirm a verified OTP; consume + reserve succeed together.
create or replace function public.confirm_verified_withdrawal(p_user_id uuid, p_challenge_id uuid, p_code_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_challenge public.email_security_challenges%rowtype; v_row public.transactions%rowtype;
begin
  select * into v_challenge from public.email_security_challenges
    where id = p_challenge_id and user_id = p_user_id for update;
  if not found or v_challenge.purpose <> 'withdrawal' or v_challenge.code_hash is distinct from p_code_hash then
    raise exception 'Código de confirmación no válido.';
  end if;
  if v_challenge.consumed_at is not null then
    select * into v_row from public.transactions where email_challenge_id = p_challenge_id and user_id = p_user_id;
    if not found then raise exception 'Este código ya fue utilizado.'; end if;
  else
    if v_challenge.expires_at <= now() or v_challenge.attempts >= 5 then
      raise exception 'El código expiró o se agotaron los intentos.';
    end if;
    update public.email_security_challenges set consumed_at = now() where id = p_challenge_id;
    insert into public.transactions(id, user_id, username, type, label, amount, status, network, wallet, provider_status, email_challenge_id)
      values ('WDR-' || p_challenge_id, p_user_id, (select username from public.profiles where id = p_user_id),
        'withdraw', 'Solicitud de retiro · BNB Chain', -(v_challenge.payload->>'amount')::numeric,
        'pending', v_challenge.payload->>'network', v_challenge.payload->>'wallet', 'email_verified', p_challenge_id)
      returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'fee', v_row.fee,
    'netAmount', v_row.net_amount, 'amount', -v_row.amount, 'wallet', v_row.wallet,
    'balance', (public.get_account_ledger_summary(p_user_id)->>'balance')::numeric,
    'message', 'Correo verificado. El monto solicitado está reservado.');
end;
$$;
revoke all on function public.confirm_verified_withdrawal(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_verified_withdrawal(uuid,uuid,text) to service_role;

-- Ledger writes are server-owned; clients cannot forge confirmations or release holds.
revoke insert, update, delete on public.transactions from anon, authenticated;
notify pgrst, 'reload schema';
