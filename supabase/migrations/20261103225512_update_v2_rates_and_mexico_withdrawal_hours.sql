-- Pre-launch repricing only. Never changes existing contract entitlements.
begin;
set local lock_timeout='5s';
lock table public.plans,public.contracts in access exclusive mode;
do $$ begin
  if exists(select 1 from public.contracts where plan_id in ('v2-17d','v2-33d'))
    or exists(select 1 from public.plans where node_version=2 and active)
    or exists(select 1 from public.platform_settings where key='nodes_v2_release' and value->>'enabled'='true') then
    raise exception 'Repricing requires an unreleased catalog with no affected contracts.';
  end if;
end $$;
alter table public.plans drop constraint plans_v2_terms_check;
alter table public.plans disable trigger protect_node_generation_terms;
update public.plans set rate_min=.009,rate_max=.013 where id='v2-17d' and node_version=2;
update public.plans set rate_min=.015,rate_max=.022 where id='v2-33d' and node_version=2;
alter table public.plans enable trigger protect_node_generation_terms;
alter table public.plans add constraint plans_v2_terms_check check (node_version=1 or (
  cadence='business_days' and principal_returned and (
    (min_amount=10 and (
      (id='v2-10d' and duration_days=10 and rate_min=.005 and rate_max=.007) or
      (id='v2-17d' and duration_days=17 and rate_min=.009 and rate_max=.013) or
      (id='v2-33d' and duration_days=33 and rate_min=.015 and rate_max=.022)
    )) or
    (id='v2-founder' and duration_days=33 and rate_min=.02 and rate_max=.02 and min_amount=2000.01)
  )
));
-- Preserve all source buckets, daily limits, blocks and access grants.
do $hours$
declare original text; revised text;
begin
  original:=pg_get_functiondef('public.get_withdrawal_availability(uuid,timestamptz)'::regprocedure);
  if position('interval ''8 hours''' in original)=0 or position('interval ''7 hours''' in original)=0 then
    raise exception 'Unexpected withdrawal schedule; migration stopped.';
  end if;
  revised:=replace(replace(original,'interval ''8 hours''','interval ''9 hours'''),'interval ''7 hours''','interval ''5 hours''');
  execute revised;
  original:=pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure);
  revised:=replace(original,'8:00 a 15:00','9:00 a 14:00');
  if revised=original then raise exception 'Unexpected withdrawal validation message.'; end if;
  execute revised;
end $hours$;
notify pgrst,'reload schema';
commit;
