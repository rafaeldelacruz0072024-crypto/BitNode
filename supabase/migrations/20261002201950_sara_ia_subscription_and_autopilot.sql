-- SARA IA: manual monthly USDT subscription and weekday automation of the
-- existing authenticated daily-task RPC. No separate reward engine is added.
begin;

create schema if not exists bitnode_private;
create extension if not exists pg_cron with schema pg_catalog;

-- Golden rule: SARA IA requires an active 21-day node on an enabled plan.
create or replace function bitnode_private.has_active_sara_node(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.contracts c join public.plans p on p.id = c.plan_id
    where c.user_id = p_user_id and c.status = 'active'
      and p.active and p.duration_days = 21
  );
$$;
revoke all on function bitnode_private.has_active_sara_node(uuid) from public, anon, authenticated;

create table if not exists public.sara_ia_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  paid_through_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sara_ia_payments (
  order_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  price_amount numeric(10,2) not null default 25.00 check (price_amount = 25.00),
  price_currency text not null default 'usd' check (price_currency = 'usd'),
  pay_currency text not null check (pay_currency in ('usdttrc20', 'usdtbsc')),
  provider_payment_id text unique,
  expected_pay_amount numeric(30,12),
  provider_status text not null default 'waiting',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'review')),
  actually_paid numeric(30,12),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists sara_ia_payments_user_created_idx
  on public.sara_ia_payments(user_id, created_at desc);

create table if not exists public.sara_ia_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_date date not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, business_date)
);

alter table public.sara_ia_subscriptions enable row level security;
alter table public.sara_ia_payments enable row level security;
alter table public.sara_ia_runs enable row level security;
revoke all on public.sara_ia_subscriptions, public.sara_ia_payments, public.sara_ia_runs from public, anon, authenticated;
grant select, insert, update on public.sara_ia_subscriptions, public.sara_ia_payments, public.sara_ia_runs to service_role;

create or replace function bitnode_private.require_sara_21_day_node()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not bitnode_private.has_active_sara_node(new.user_id) then
    raise exception 'Regla de oro: necesitas un nodo de 21 días activo para contratar SARA IA.';
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.require_sara_21_day_node() from public, anon, authenticated;
drop trigger if exists require_sara_21_day_node on public.sara_ia_payments;
create trigger require_sara_21_day_node before insert on public.sara_ia_payments
for each row execute function bitnode_private.require_sara_21_day_node();

create or replace function public.complete_sara_ia_payment(
  p_order_id text, p_payment_id text, p_pay_currency text, p_price_amount numeric, p_actually_paid numeric
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.sara_ia_payments%rowtype;
  v_user_id uuid;
begin
  select * into v_payment from public.sara_ia_payments where order_id = p_order_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_payment.status = 'completed' then return jsonb_build_object('status', 'already_completed'); end if;
  if v_payment.status <> 'pending'
     or v_payment.provider_payment_id is distinct from p_payment_id
     or lower(v_payment.pay_currency) <> lower(coalesce(p_pay_currency, ''))
     or lower(v_payment.pay_currency) not in ('usdttrc20', 'usdtbsc')
     or p_price_amount is distinct from 25.00::numeric
     or v_payment.expected_pay_amount is null
     or p_actually_paid is null
     or p_actually_paid < v_payment.expected_pay_amount then
    update public.sara_ia_payments set status = 'review', provider_status = 'finished_mismatch', actually_paid = p_actually_paid
    where order_id = p_order_id;
    return jsonb_build_object('status', 'review_required');
  end if;

  update public.sara_ia_payments set status = 'completed', provider_status = 'finished',
    actually_paid = p_actually_paid, completed_at = now()
  where order_id = p_order_id and status = 'pending'
  returning user_id into v_user_id;
  if v_user_id is null then return jsonb_build_object('status', 'already_completed'); end if;

  insert into public.sara_ia_subscriptions(user_id, paid_through_at)
  values (v_user_id, now() + interval '1 month')
  on conflict (user_id) do update set
    paid_through_at = greatest(public.sara_ia_subscriptions.paid_through_at, now()) + interval '1 month',
    updated_at = now();
  return jsonb_build_object('status', 'completed');
end;
$$;
revoke all on function public.complete_sara_ia_payment(text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.complete_sara_ia_payment(text, text, text, numeric, numeric) to service_role;

create or replace function bitnode_private.run_sara_ia_daily()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sub record;
  v_cycle public.daily_task_cycles%rowtype;
  v_first_node_at timestamptz;
  v_completed text[];
  v_key text;
  v_result jsonb;
  v_done integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_today date := (now() at time zone 'America/Santo_Domingo')::date;
  v_tasks constant text[] := array['sync_node', 'validate_block', 'audit_mempool', 'sign_checkpoint'];
begin
  if extract(isodow from now() at time zone 'America/Santo_Domingo') not between 1 and 5 then
    return jsonb_build_object('status', 'weekend', 'completed', 0);
  end if;
  if not pg_try_advisory_xact_lock(hashtext('bitnode_sara_ia_daily')) then
    return jsonb_build_object('status', 'already_running');
  end if;

  for v_sub in
    select s.user_id from public.sara_ia_subscriptions s
    where s.paid_through_at > now()
    order by s.user_id
  loop
    begin
      if exists (select 1 from public.sara_ia_runs r where r.user_id = v_sub.user_id and r.business_date = v_today) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if not bitnode_private.has_active_sara_node(v_sub.user_id) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      select min(c.created_at) into v_first_node_at from public.contracts c
      where c.user_id = v_sub.user_id and c.status in ('active', 'completed', 'expired');
      if v_first_node_at is null or now() < v_first_node_at + interval '24 hours' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      select * into v_cycle from public.daily_task_cycles c where c.user_id = v_sub.user_id;
      if found and cardinality(coalesce(v_cycle.completed_tasks, array[]::text[])) >= 4
         and coalesce(v_cycle.deadline_at, now() + interval '1 second') > now() then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.sara_ia_runs(user_id, business_date, status)
      values (v_sub.user_id, v_today, 'running')
      on conflict (user_id, business_date) do update set status = 'running', details = '{}'::jsonb
      where public.sara_ia_runs.status <> 'completed';
      if not found then v_skipped := v_skipped + 1; continue; end if;

      perform set_config('request.jwt.claim.sub', v_sub.user_id::text, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      select coalesce(c.completed_tasks, array[]::text[]) into v_completed
      from public.daily_task_cycles c where c.user_id = v_sub.user_id;
      v_completed := coalesce(v_completed, array[]::text[]);
      foreach v_key in array v_tasks loop
        if not (v_key = any(v_completed)) then
          v_result := public.complete_daily_tasks(v_key);
          if coalesce(v_result->>'status', '') in ('credited', 'task_completed', 'already_completed') then
            v_completed := array_append(v_completed, v_key);
          else
            raise exception 'Existing task RPC did not accept SARA task %: %', v_key, v_result;
          end if;
        end if;
      end loop;
      update public.sara_ia_runs set details = jsonb_build_object('status', 'completed', 'tasks', to_jsonb(v_completed))
      where user_id = v_sub.user_id and business_date = v_today;
      v_done := v_done + 1;
    exception when others then
      insert into public.sara_ia_runs(user_id, business_date, status, details)
      values (v_sub.user_id, v_today, 'failed', jsonb_build_object('error', sqlerrm))
      on conflict (user_id, business_date) do update set status = 'failed', details = excluded.details
      where public.sara_ia_runs.status <> 'completed';
      v_failed := v_failed + 1;
    end;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
  end loop;
  return jsonb_build_object('status', 'finished', 'completed', v_done, 'skipped', v_skipped, 'failed', v_failed);
end;
$$;
revoke all on function bitnode_private.run_sara_ia_daily() from public, anon, authenticated;
grant execute on function bitnode_private.run_sara_ia_daily() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bitnode-sara-ia-weekday-tasks') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bitnode-sara-ia-weekday-tasks';
  end if;
  perform cron.schedule('bitnode-sara-ia-weekday-tasks', '*/5 11-23 * * 1-5',
    'select bitnode_private.run_sara_ia_daily()');
end;
$$;

notify pgrst, 'reload schema';
commit;
