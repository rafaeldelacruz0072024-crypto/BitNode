begin;
create table public.influencer_plans(
  code text primary key,
  name text not null,
  price numeric(18,2) not null check(price>0),
  reward_cap numeric(18,2) not null check(reward_cap>0),
  weekly_cap numeric(18,2) not null check(weekly_cap>0),
  reward_rate numeric(18,4) not null default 0.01 check(reward_rate>0),
  duration_days integer not null default 120 check(duration_days between 1 and 365),
  active boolean not null default true,
  sort_order integer not null default 0
);
insert into public.influencer_plans(code,name,price,reward_cap,weekly_cap,reward_rate,duration_days,sort_order) values
('starter','Starter',50,100,20,0.01,120,1),
('creator','Creator',100,200,40,0.01,120,2),
('pro','Pro',250,500,100,0.01,120,3);
alter table public.influencer_plans enable row level security;
revoke all on public.influencer_plans from anon,authenticated;
grant select on public.influencer_plans to authenticated;
create policy influencer_plans_read on public.influencer_plans for select to authenticated using(active);
alter table public.influencer_packages add column plan_code text references public.influencer_plans(code);
update public.influencer_packages set plan_code='creator' where plan_code is null;
alter table public.influencer_packages alter column plan_code set not null;
notify pgrst,'reload schema';
commit;
