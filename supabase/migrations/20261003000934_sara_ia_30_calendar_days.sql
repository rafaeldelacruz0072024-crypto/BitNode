begin;
-- Future purchases and renewals only; preserve existing paid-through dates.
create or replace function public.complete_sara_ia_payment(
  p_order_id text, p_payment_id text, p_pay_currency text, p_price_amount numeric, p_actually_paid numeric
) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'America/Santo_Domingo' as $$
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
  values (v_user_id, now() + interval '30 days')
  on conflict (user_id) do update set
    paid_through_at = greatest(public.sara_ia_subscriptions.paid_through_at, now()) + interval '30 days',
    updated_at = now();
  return jsonb_build_object('status', 'completed');
end;
$$;
revoke all on function public.complete_sara_ia_payment(text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.complete_sara_ia_payment(text, text, text, numeric, numeric) to service_role;


notify pgrst, 'reload schema';
commit;
