-- Read-only production checks for the one-time flexible-node direct commission.
select
  to_regclass('bitnode_private.flexible_direct_commission_claims') is not null
    as claim_table_installed,
  exists (
    select 1
    from pg_trigger
    where tgname = 'guard_flexible_direct_commission'
      and tgrelid = 'public.commission_ledger'::regclass
      and not tgisinternal
  ) as guard_trigger_installed,
  (
    select count(*)
    from (
      select source_user_id
      from bitnode_private.flexible_direct_commission_claims
      group by source_user_id
      having count(*) > 1
    ) duplicate_claims
  ) as duplicate_claim_users,
  (
    select count(*)
    from (
      select ledger.source_user_id
      from public.commission_ledger ledger
      join public.commission_events events
        on events.source_event_id = ledger.source_event_id
      join public.contracts contracts
        on contracts.id = events.contract_id
       and contracts.user_id = ledger.source_user_id
      join public.plans plans on plans.id = contracts.plan_id
      where ledger.commission_type = 'direct'
        and plans.duration_days is null
      group by ledger.source_user_id
      having count(*) > 1
    ) duplicate_payments
  ) as users_with_historical_duplicate_payments;
