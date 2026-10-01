-- Run after 20261001004519_reinvestment_bonus_capital_5_percent.sql.
select
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.finite_node_capital_choices'::regclass
      and tgname = 'apply_reinvestment_bonus'
      and not tgisinternal
  ) as reinvest_bonus_trigger_installed,
  position('round(new.amount * 0.05, 2)' in pg_get_functiondef('bitnode_private.apply_reinvestment_bonus()'::regprocedure)) > 0
    as five_percent_bonus_configured;

select
  choice.contract_id,
  choice.amount as reinvested_amount,
  round(choice.amount * 0.05, 2) as promotional_capital,
  contract.amount as new_node_capital,
  transaction.provider_status as promotion_ledger_marker,
  contract.amount = choice.amount + round(choice.amount * 0.05, 2) as bonus_matches
from public.finite_node_capital_choices choice
join public.contracts contract on contract.id = choice.new_contract_id
join public.transactions transaction on transaction.id = choice.new_contract_id
where choice.action = 'reinvest'
order by choice.requested_at desc
limit 20;
