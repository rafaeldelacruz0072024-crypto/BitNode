begin;
-- Updated prizes: ten trips at 15,000; raffle pool only [10,000, 15,000).
-- No draw, winner assignment, wallet credit, or financial mutation is performed.
create or replace function public.get_latam_promotion(p_user_id uuid,p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'Usuario requerido'; end if;
 if p_admin and not exists(select 1 from public.profiles where id=p_user_id and role='admin') then raise exception 'Administrador requerido'; end if;
 with totals as (
  select sponsor_id,sum(amount) total from bitnode_private.latam_valid_sales group by sponsor_id
 ), raffle as (
  select sponsor_id,total from totals where total>=10000 and total<15000
 ), running as (
  select sponsor_id,validated_at,id,sum(amount) over(partition by sponsor_id order by validated_at,id) total
  from bitnode_private.latam_valid_sales
 ), qualified as (
  select sponsor_id,min(validated_at) qualified_at from running where total>=15000 group by sponsor_id
 ), ranked as (
  select q.*,row_number() over(order by qualified_at,sponsor_id) position from qualified q
 )
 select jsonb_build_object(
 'rulesVersion','latam-trip-raffle-v2',
 'total',coalesce((select total from totals where sponsor_id=p_user_id),0),
 'raffleEligible',exists(select 1 from raffle where sponsor_id=p_user_id),
 'raffleParticipantCount',(select count(*) from raffle),
 'raffleDrawStatus','pending',
 'raffleParticipants',case when p_admin then coalesce((
  select jsonb_agg(jsonb_build_object('userId',r.sponsor_id,'username',p.username,'total',r.total) order by p.username,r.sponsor_id)
  from raffle r join public.profiles p on p.id=r.sponsor_id),'[]'::jsonb) else '[]'::jsonb end,
 'winners',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'username',p.username,'qualifiedAt',r.qualified_at,'prize','trip') order by r.position)
 from ranked r join public.profiles p on p.id=r.sponsor_id where r.position<=10),'[]'::jsonb),
 'validations',case when p_admin then coalesce((select jsonb_agg(to_jsonb(s) order by s.validated_at desc) from public.latam_promotion_sales s),'[]'::jsonb) else '[]'::jsonb end)
 into result;
 return result;
end;
$$;
revoke all on function public.get_latam_promotion(uuid,boolean) from public,anon,authenticated;
grant execute on function public.get_latam_promotion(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
