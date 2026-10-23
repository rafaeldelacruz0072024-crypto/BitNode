begin;

-- Reviewed production cutoff: 2026-10-22 14:32:36.669968+00.
-- This migration records only the two audited historical groups. It does not
-- debit capital, commissions or the current wallet balance. Recovery happens
-- exclusively when a future node ROI credit is posted by the existing trigger.
create table if not exists bitnode_private.roi_recovery_debt_sources (
  source_key text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_transaction_id text not null references public.transactions(id),
  reason text not null check (reason in ('cycle_reset_unrecovered','weekend_mexico')),
  amount numeric not null check (amount > 0),
  audited_at timestamptz not null default now(),
  unique (source_transaction_id, reason)
);
revoke all on table bitnode_private.roi_recovery_debt_sources from public, anon, authenticated;
grant select on table bitnode_private.roi_recovery_debt_sources to service_role;

do $verify$
declare
  v_reset numeric;
  v_weekend numeric;
begin
  with reviewed as (
    select r.status reward_status,t.id,t.amount,t.created_at,
      greatest(t.amount-coalesce(d.debit,0),0) residual
    from public.contract_cycle_rewards r
    join public.transactions t on t.id=r.transaction_id and t.user_id=r.user_id
    left join lateral (
      select -coalesce(sum(x.amount),0) debit
      from public.transactions x
      where x.provider_status='cycle_reset:'||t.id
        and x.status='completed' and x.type='yield' and x.amount<0
    ) d on true
    where t.status='completed' and t.type='yield' and t.amount>0
      and t.created_at <= timestamptz '2026-10-22 14:32:36.669968+00'
  )
  select
    coalesce(sum(residual) filter(where reward_status='reversed' and residual>0.011),0),
    coalesce(sum(residual) filter(where reward_status<>'reversed' and residual>0.011
      and extract(isodow from created_at at time zone 'America/Mexico_City') in(6,7)),0)
  into v_reset,v_weekend from reviewed;

  if round(v_reset,2)<>1399.49 or round(v_weekend,2)<>284.74 then
    raise exception 'Historical ROI review changed (reset %, weekend %); aborting without altering debt',
      round(v_reset,2),round(v_weekend,2);
  end if;
end;
$verify$;

with reviewed as (
  select r.user_id,r.status reward_status,t.id transaction_id,t.amount,t.created_at,
    greatest(t.amount-coalesce(d.debit,0),0) residual
  from public.contract_cycle_rewards r
  join public.transactions t on t.id=r.transaction_id and t.user_id=r.user_id
  left join lateral (
    select -coalesce(sum(x.amount),0) debit
    from public.transactions x
    where x.provider_status='cycle_reset:'||t.id
      and x.status='completed' and x.type='yield' and x.amount<0
  ) d on true
  where t.status='completed' and t.type='yield' and t.amount>0
    and t.created_at <= timestamptz '2026-10-22 14:32:36.669968+00'
), candidates as (
  select 'historical-reset:'||transaction_id source_key,user_id,transaction_id,
    'cycle_reset_unrecovered'::text reason,residual amount
  from reviewed where reward_status='reversed' and residual>0.011
  union all
  select 'historical-weekend-mx:'||transaction_id,user_id,transaction_id,
    'weekend_mexico'::text,residual
  from reviewed where reward_status<>'reversed' and residual>0.011
    and extract(isodow from created_at at time zone 'America/Mexico_City') in(6,7)
), inserted as (
  insert into bitnode_private.roi_recovery_debt_sources(
    source_key,user_id,source_transaction_id,reason,amount
  )
  select source_key,user_id,transaction_id,reason,amount from candidates
  on conflict do nothing
  returning user_id,amount
), totals as (
  select user_id,sum(amount) amount from inserted group by user_id
)
insert into bitnode_private.roi_recovery_debts(user_id,outstanding,accrued_total)
select user_id,amount,amount from totals
on conflict (user_id) do update set
  outstanding=bitnode_private.roi_recovery_debts.outstanding+excluded.outstanding,
  accrued_total=bitnode_private.roi_recovery_debts.accrued_total+excluded.accrued_total,
  updated_at=now();

-- The future-ROI recovery trigger already excludes direct/binary commissions,
-- reset debits and capital operations. Keep the user-facing label broad enough
-- to cover both reviewed causes.
create or replace function bitnode_private.recover_roi_reset_debt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_outstanding numeric;
  v_recovery numeric;
begin
  if new.status <> 'completed' or new.amount <= 0 or new.type <> 'yield'
     or new.id not like 'YIELD-%'
     or new.id like 'YIELD-RESET-%'
     or coalesce(new.provider_status,'') like 'cycle_reset:%'
     or coalesce(new.provider_status,'') like 'roi_debt_recovery:%' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;

  select outstanding into v_outstanding
  from bitnode_private.roi_recovery_debts where user_id = new.user_id for update;
  if not found or v_outstanding <= 0 then return new; end if;
  v_recovery := least(v_outstanding,new.amount);

  insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
  select 'ROI-DEBT-' || new.id,new.user_id,p.username,'yield',
    'Recuperacion de ROI no elegible',-v_recovery,'completed',
    'roi_debt_recovery:' || new.id
  from public.profiles p where p.id = new.user_id
  on conflict (id) do nothing;
  if found then
    update bitnode_private.roi_recovery_debts
    set outstanding = greatest(outstanding-v_recovery,0),
        recovered_total = recovered_total+v_recovery, updated_at = now()
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.recover_roi_reset_debt() from public, anon, authenticated;

notify pgrst,'reload schema';
commit;
