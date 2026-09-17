-- Run after applying 20260917204415_finite_node_capital_choice.sql.
-- Read-only checks of installation and real claim/reinvestment rows.
select
  to_regclass('public.finite_node_capital_choices') is not null as choice_table_ready,
  to_regprocedure('public.choose_finite_node_capital(uuid,text,text)') is not null as user_rpc_ready,
  to_regprocedure('public.manage_finite_node_claim(text,text,uuid,text)') is not null as admin_rpc_ready;

select c.contract_id, p.username, c.action, c.status, c.amount, c.fee,
  c.net_amount, c.requested_at, c.payable_at, c.resolved_at,
  c.new_contract_id,
  case when c.action = 'claim' then c.payable_at = c.requested_at + interval '24 hours'
    else c.new_contract_id is not null end as lifecycle_valid
from public.finite_node_capital_choices c
join public.profiles p on p.id = c.user_id
order by c.requested_at desc limit 30;
