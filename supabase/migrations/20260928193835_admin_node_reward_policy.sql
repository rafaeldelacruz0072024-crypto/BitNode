begin;
create table public.node_reward_policy (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('minimum','lower_half','maximum')),
  period_type text not null check (period_type in ('day','week','month')),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  enabled boolean not null default true,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table public.node_reward_policy enable row level security;
revoke all on public.node_reward_policy from public, anon, authenticated;
grant select on public.node_reward_policy to service_role;

create or replace function public.save_node_reward_policy(p_mode text, p_period_type text, p_starts_on date, p_ends_on date, p_enabled boolean, p_expected_version integer, p_actor uuid)
returns public.node_reward_policy language plpgsql security definer set search_path = pg_catalog as $$
declare v_row public.node_reward_policy%rowtype;
begin
  if not exists (select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_mode not in ('minimum','lower_half','maximum') or p_period_type not in ('day','week','month') or p_starts_on is null or p_ends_on < p_starts_on then raise exception 'Invalid policy' using errcode='22023'; end if;
  select * into v_row from public.node_reward_policy where singleton for update;
  if coalesce(v_row.version,0) <> p_expected_version then raise exception 'Policy changed' using errcode='40001'; end if;
  insert into public.node_reward_policy(singleton,mode,period_type,starts_on,ends_on,enabled,version,updated_by)
  values(true,p_mode,p_period_type,p_starts_on,p_ends_on,p_enabled,p_expected_version+1,p_actor)
  on conflict(singleton) do update set mode=excluded.mode,period_type=excluded.period_type,starts_on=excluded.starts_on,ends_on=excluded.ends_on,enabled=excluded.enabled,version=excluded.version,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_row; return v_row;
end $$;
revoke all on function public.save_node_reward_policy(text,text,date,date,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.save_node_reward_policy(text,text,date,date,boolean,integer,uuid) to service_role;

create or replace function bitnode_private.monthly_daily_rate(p_duration integer, p_day date)
returns numeric language plpgsql volatile set search_path=pg_catalog as $$
declare v_policy public.node_reward_policy%rowtype; v_min numeric; v_max numeric; v_monthly numeric;
begin
  select * into v_policy from public.node_reward_policy where singleton and enabled and p_day between starts_on and ends_on;
  if found then
    select rate_min,rate_max into v_min,v_max from public.plans where active and duration_days is not distinct from p_duration order by created_at desc limit 1;
    if v_policy.mode='minimum' then return v_min; elsif v_policy.mode='maximum' then return v_max; else return v_min + random()*((v_max-v_min)/2); end if;
  end if;
  select (r.rates ->> case when p_duration is null then 'daily' when p_duration=7 then 'seven' when p_duration=14 then 'fourteen' when p_duration=21 then 'twentyOne' end)::numeric / 100 /
    (select count(*) from generate_series(date_trunc('month',p_day::timestamp),date_trunc('month',p_day::timestamp)+interval '1 month - 1 day',interval '1 day') d where extract(isodow from d) between 1 and 5)
    into v_monthly from public.monthly_node_roi r where r.month=date_trunc('month',p_day::timestamp)::date;
  return v_monthly;
end $$;
revoke all on function bitnode_private.monthly_daily_rate(integer,date) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
