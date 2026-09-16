-- fatima01 used yazduran's left referral link after codder had already been
-- placed on that left spine. Move only that leaf and transfer its historical
-- 50 points from leviduran/right to leviduran/left, ducktail/left and
-- codder/left. Existing credited commissions stay as paid: their upstream
-- branches and direct sponsor do not change.
begin;

create schema if not exists binary_repair_private;
revoke all on schema binary_repair_private from public, anon, authenticated;
create table if not exists binary_repair_private.masteredu_fatima_backup (
  user_id uuid primary key,
  old_node jsonb not null,
  old_volumes jsonb not null,
  event_amount numeric not null,
  backed_up_at timestamptz not null default now()
);
alter table binary_repair_private.masteredu_fatima_backup enable row level security;
revoke all on binary_repair_private.masteredu_fatima_backup from public, anon, authenticated;

lock table public.network_nodes in access exclusive mode;
lock table public.network_volume in share row exclusive mode;

do $repair$
declare
  v_master uuid;
  v_yaz uuid;
  v_levi uuid;
  v_duck uuid;
  v_cod uuid;
  v_fatima uuid;
  v_amount numeric;
begin
  select id into strict v_master from public.profiles where lower(username)='masteredu';
  select id into strict v_yaz from public.profiles where lower(username)='yazduran';
  select id into strict v_levi from public.profiles where lower(username)='leviduran';
  select id into strict v_duck from public.profiles where lower(username)='ducktail';
  select id into strict v_cod from public.profiles where lower(username)='codder';
  select id into strict v_fatima from public.profiles where lower(username)='fatima01';

  if exists (select 1 from public.network_nodes where user_id=v_fatima and sponsor_id=v_yaz and parent_id=v_cod and leg='left')
     and exists (select 1 from binary_repair_private.masteredu_fatima_backup where user_id=v_fatima) then
    return;
  end if;

  if not exists (select 1 from public.network_nodes where user_id=v_yaz and sponsor_id=v_master and parent_id=v_master and leg='left')
     or not exists (select 1 from public.network_nodes where user_id=v_levi and sponsor_id=v_yaz and parent_id=v_yaz and leg='left')
     or not exists (select 1 from public.network_nodes where user_id=v_duck and sponsor_id=v_master and parent_id=v_levi and leg='left')
     or not exists (select 1 from public.network_nodes where user_id=v_cod and sponsor_id=v_master and parent_id=v_duck and leg='left')
     or not exists (select 1 from public.network_nodes where user_id=v_fatima and sponsor_id=v_yaz and parent_id=v_levi and leg='right')
     or exists (select 1 from public.network_nodes where parent_id=v_fatima)
     or exists (select 1 from public.network_nodes where parent_id=v_cod)
     or not exists (
       select 1 from auth.users u join public.profiles p on p.referral_code=u.raw_user_meta_data->>'sponsor_referral_code'
       where u.id=v_fatima and p.id=v_yaz and u.raw_user_meta_data->>'preferred_leg'='left'
     ) then
    raise exception 'Masteredu branch or fatima01 referral changed; manual review required';
  end if;

  if (select count(*) from public.commission_events where user_id=v_fatima and event_type='contract_confirmed') <> 1
     or (select count(*) from public.contracts where user_id=v_fatima) <> 1
     or (select count(*) from public.commission_ledger where source_user_id=v_fatima) <> 3
     or exists (select 1 from public.commission_ledger where source_user_id=v_fatima and beneficiary_id in (v_levi,v_duck,v_cod)) then
    raise exception 'fatima01 financial history changed; manual reconciliation required';
  end if;
  select amount into strict v_amount from public.commission_events
  where user_id=v_fatima and event_type='contract_confirmed';
  if v_amount <> 50
     or not exists (select 1 from public.network_volume where user_id=v_levi and leg='right' and volume=v_amount and matched_volume=0)
     or exists (select 1 from public.network_volume where user_id=v_levi and leg='left' and (volume<>0 or matched_volume<>0))
     or exists (select 1 from public.network_volume where user_id in (v_duck,v_cod)) then
    raise exception 'Binary volume changed; manual reconciliation required';
  end if;

  insert into binary_repair_private.masteredu_fatima_backup(user_id,old_node,old_volumes,event_amount)
  select v_fatima, to_jsonb(n),
    coalesce((select jsonb_agg(to_jsonb(vol) order by vol.user_id,vol.leg)
      from public.network_volume vol where vol.user_id in (v_levi,v_duck,v_cod)), '[]'::jsonb),
    v_amount
  from public.network_nodes n where n.user_id=v_fatima;
  if not found then raise exception 'fatima01 backup was not saved'; end if;

  update public.network_nodes set parent_id=v_cod, leg='left' where user_id=v_fatima;
  update public.network_volume set volume=volume-v_amount, updated_at=now()
  where user_id=v_levi and leg='right';
  insert into public.network_volume(user_id,leg,volume,matched_volume)
  values (v_levi,'left',v_amount,0), (v_duck,'left',v_amount,0), (v_cod,'left',v_amount,0)
  on conflict (user_id,leg) do update
    set volume=public.network_volume.volume+excluded.volume, updated_at=now();

  if not exists (select 1 from public.network_nodes where user_id=v_fatima and parent_id=v_cod and leg='left' and sponsor_id=v_yaz)
     or not exists (select 1 from public.network_volume where user_id=v_levi and leg='right' and volume=0 and matched_volume=0)
     or (select count(*) from public.network_volume where user_id in (v_levi,v_duck,v_cod) and leg='left' and volume=v_amount and matched_volume=0) <> 3 then
    raise exception 'Masteredu branch reconciliation did not match expected state';
  end if;
end;
$repair$;

set constraints all immediate;
notify pgrst, 'reload schema';
commit;
