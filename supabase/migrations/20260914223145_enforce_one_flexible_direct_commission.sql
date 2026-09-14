-- A flexible (no fixed duration) node earns its sponsor's direct commission
-- only on the member's first activation. Closing and activating another
-- flexible node must not create another direct payout for the same member.

create schema if not exists bitnode_private;
revoke all on schema bitnode_private from public, anon, authenticated;

create table if not exists bitnode_private.flexible_direct_commission_claims (
  source_user_id uuid primary key references auth.users(id) on delete restrict,
  beneficiary_id uuid not null references auth.users(id) on delete restrict,
  first_source_event_id text not null,
  first_contract_id text not null,
  claimed_at timestamptz not null default now()
);

revoke all on table bitnode_private.flexible_direct_commission_claims
  from public, anon, authenticated;

-- Preserve every payout already made before this rule. The earliest flexible
-- direct commission becomes the member's single historical claim.
insert into bitnode_private.flexible_direct_commission_claims (
  source_user_id,
  beneficiary_id,
  first_source_event_id,
  first_contract_id,
  claimed_at
)
select distinct on (ledger.source_user_id)
  ledger.source_user_id,
  ledger.beneficiary_id,
  ledger.source_event_id,
  contracts.id,
  ledger.created_at
from public.commission_ledger ledger
join public.commission_events events
  on events.source_event_id = ledger.source_event_id
join public.contracts contracts
  on contracts.id = events.contract_id
 and contracts.user_id = ledger.source_user_id
join public.plans plans
  on plans.id = contracts.plan_id
where ledger.commission_type = 'direct'
  and plans.duration_days is null
order by ledger.source_user_id, ledger.created_at, ledger.id
on conflict (source_user_id) do nothing;

create or replace function bitnode_private.guard_flexible_direct_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract_id text;
  v_is_flexible boolean := false;
  v_claimed integer := 0;
begin
  if new.commission_type <> 'direct' then
    return new;
  end if;

  v_contract_id := coalesce(
    nullif(new.metadata ->> 'contract_id', ''),
    (select events.contract_id
       from public.commission_events events
      where events.source_event_id = new.source_event_id)
  );

  select (plans.duration_days is null)
    into v_is_flexible
  from public.contracts contracts
  join public.plans plans on plans.id = contracts.plan_id
  where contracts.id = v_contract_id
    and contracts.user_id = new.source_user_id;

  if coalesce(v_is_flexible, false) then
    insert into bitnode_private.flexible_direct_commission_claims (
      source_user_id,
      beneficiary_id,
      first_source_event_id,
      first_contract_id
    ) values (
      new.source_user_id,
      new.beneficiary_id,
      new.source_event_id,
      v_contract_id
    )
    on conflict (source_user_id) do nothing;
    get diagnostics v_claimed = row_count;

    if v_claimed = 0 then
      return null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function bitnode_private.guard_flexible_direct_commission()
  from public, anon, authenticated;

drop trigger if exists guard_flexible_direct_commission
  on public.commission_ledger;
create trigger guard_flexible_direct_commission
before insert on public.commission_ledger
for each row execute function bitnode_private.guard_flexible_direct_commission();

comment on table bitnode_private.flexible_direct_commission_claims is
  'One lifetime direct-referral commission claim per member for flexible nodes.';

notify pgrst, 'reload schema';
