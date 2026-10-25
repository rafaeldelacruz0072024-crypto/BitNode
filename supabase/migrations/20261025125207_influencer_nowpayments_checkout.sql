begin;

create table if not exists public.influencer_payments (
  order_id text primary key,
  package_id uuid not null references public.influencer_packages(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'nowpayments' check (provider='nowpayments'),
  provider_payment_id text not null unique,
  price_amount numeric(18,2) not null check(price_amount>0),
  price_currency text not null default 'usd' check(price_currency='usd'),
  pay_amount numeric(30,12) not null check(pay_amount>0),
  pay_currency text not null check(pay_currency in ('usdttrc20','usdtbsc')),
  pay_address text not null,
  status text not null default 'pending' check(status in ('pending','completed','failed','review')),
  provider_status text not null default 'waiting',
  actually_paid numeric(30,12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(package_id)
);

alter table public.influencer_payments enable row level security;
drop policy if exists influencer_payments_owner_select on public.influencer_payments;
create policy influencer_payments_owner_select on public.influencer_payments for select to authenticated using(user_id=auth.uid());
revoke all on public.influencer_payments from public,anon,authenticated;
grant select on public.influencer_payments to authenticated;

create or replace function public.complete_influencer_nowpayment(
  p_order_id text,p_payment_id text,p_pay_currency text,p_price_amount numeric,p_pay_amount numeric,p_actually_paid numeric
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_payment public.influencer_payments%rowtype; v_package public.influencer_packages%rowtype; v_plan public.influencer_plans%rowtype;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select * into v_payment from public.influencer_payments where order_id=p_order_id for update;
  if not found then raise exception 'Pago no encontrado' using errcode='P0001'; end if;
  if v_payment.status='completed' then return jsonb_build_object('id',v_payment.package_id,'status','active','duplicate',true); end if;
  if v_payment.provider_payment_id<>p_payment_id or v_payment.pay_currency<>lower(p_pay_currency)
     or v_payment.price_amount<>round(p_price_amount,2) or abs(v_payment.pay_amount-p_pay_amount)>0.00000001
     or coalesce(p_actually_paid,0)+0.00000001<v_payment.pay_amount then
    update public.influencer_payments set status='review',provider_status='finished_mismatch',actually_paid=p_actually_paid,updated_at=now() where order_id=p_order_id;
    raise exception 'El pago requiere revisión por diferencia de monto o moneda' using errcode='P0001';
  end if;
  select * into v_package from public.influencer_packages where id=v_payment.package_id for update;
  if not found or v_package.user_id<>v_payment.user_id or v_package.status<>'pending' then raise exception 'Paquete no activable' using errcode='P0001'; end if;
  select * into v_plan from public.influencer_plans where code=v_package.plan_code and active;
  if not found or v_plan.price<>v_payment.price_amount then raise exception 'Plan o precio inválido' using errcode='P0001'; end if;
  update public.influencer_packages set status='active',starts_at=now(),ends_at=now()+make_interval(days=>v_plan.duration_days),
    activated_at=now(),purchase_method='crypto',payment_reference=p_order_id,paid_at=now(),updated_at=now()
  where id=v_package.id;
  update public.influencer_payments set status='completed',provider_status='finished',actually_paid=p_actually_paid,completed_at=now(),updated_at=now() where order_id=p_order_id;
  return jsonb_build_object('id',v_package.id,'status','active','duration_days',v_plan.duration_days);
end;
$$;
revoke all on function public.complete_influencer_nowpayment(text,text,text,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.complete_influencer_nowpayment(text,text,text,numeric,numeric,numeric) to service_role;

notify pgrst,'reload schema';
commit;
