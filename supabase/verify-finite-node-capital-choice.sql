-- Run after applying 20260917204415_finite_node_capital_choice.sql.
-- Read-only checks of installation and real claim/reinvestment rows.
select
  to_regclass('public.finite_node_capital_choices') is not null as choice_table_ready,
  to_regprocedure('public.choose_finite_node_capital(uuid,text,text)') is not null as user_rpc_ready,
  to_regprocedure('public.manage_finite_node_claim(text,text,uuid,text)') is not null as admin_rpc_ready,
  to_regclass('public.finite_node_one_claim_per_mexico_day') is null as no_daily_claim_limit,
  not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.finite_node_capital_choices'::regclass
      and tgname = 'guard_user_capital_claim_block' and not tgisinternal
  ) as no_admin_withdrawal_block,
  position('finite_node_capital_choices' in pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure)) = 0
    as claim_does_not_consume_daily_withdrawal;

select c.contract_id, p.username, c.action, c.status, c.amount, c.fee,
  c.net_amount, c.requested_at, c.payable_at, c.resolved_at,
  c.new_contract_id,
  case when c.action = 'claim' then c.payable_at = c.requested_at + interval '24 hours'
    else c.new_contract_id is not null end as lifecycle_valid
from public.finite_node_capital_choices c
join public.profiles p on p.id = c.user_id
order by c.requested_at desc limit 30;
