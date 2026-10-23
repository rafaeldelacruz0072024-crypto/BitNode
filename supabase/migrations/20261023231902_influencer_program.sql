begin;

create table public.influencer_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','active','paused','completed','expired','cancelled')),
  price numeric(18,2) not null default 100 check(price > 0),
  reward_rate numeric(18,4) not null default 0.01 check(reward_rate > 0),
  weekly_cap numeric(18,2) not null default 25 check(weekly_cap > 0),
  reward_cap numeric(18,2) not null default 200 check(reward_cap > 0),
  earned_total numeric(18,2) not null default 0 check(earned_total >= 0),
  verified_views bigint not null default 0 check(verified_views >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  activated_by uuid references auth.users(id),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint influencer_package_dates check(ends_at is null or starts_at is null or ends_at > starts_at),
  constraint influencer_package_earned_cap check(earned_total <= reward_cap)
);
create unique index influencer_one_open_package_idx on public.influencer_packages(user_id)
where status in ('pending','active','paused');
create index influencer_packages_status_idx on public.influencer_packages(status,created_at desc);

create table public.influencer_submissions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.influencer_packages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check(platform in ('instagram','facebook')),
  story_url text not null check(length(story_url) between 10 and 500),
  evidence_path text not null unique,
  campaign_code text not null check(length(campaign_code) between 3 and 60),
  story_published_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reported_views bigint not null default 0 check(reported_views between 0 and 10000000),
  verified_views bigint check(verified_views between 0 and 10000000),
  reward_amount numeric(18,2) not null default 0 check(reward_amount >= 0),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text check(review_note is null or length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  constraint influencer_submission_review check(
    (status='pending' and reviewed_by is null and reviewed_at is null and verified_views is null and reward_amount=0)
    or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null and verified_views is not null)
  )
);
create index influencer_submissions_user_idx on public.influencer_submissions(user_id,submitted_at desc);
create index influencer_submissions_review_idx on public.influencer_submissions(status,submitted_at);

create table public.influencer_weekly_payouts (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.influencer_packages(id),
  user_id uuid not null references auth.users(id),
  week_start date not null,
  week_end date not null,
  verified_views bigint not null default 0 check(verified_views >= 0),
  amount numeric(18,2) not null default 0 check(amount >= 0),
  status text not null default 'pending' check(status in ('pending','approved','credited','cancelled')),
  transaction_id text unique,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  unique(package_id,week_start),
  constraint influencer_week_range check(week_end = week_start + 6)
);

alter table public.influencer_packages enable row level security;
alter table public.influencer_submissions enable row level security;
alter table public.influencer_weekly_payouts enable row level security;
revoke all on public.influencer_packages,public.influencer_submissions,public.influencer_weekly_payouts from anon,authenticated;
grant select on public.influencer_packages,public.influencer_submissions,public.influencer_weekly_payouts to authenticated;
create policy influencer_package_owner_read on public.influencer_packages for select to authenticated using(user_id=auth.uid());
create policy influencer_submission_owner_read on public.influencer_submissions for select to authenticated using(user_id=auth.uid());
create policy influencer_payout_owner_read on public.influencer_weekly_payouts for select to authenticated using(user_id=auth.uid());

create or replace function public.admin_review_influencer_submission(
  p_admin_id uuid,
  p_submission_id uuid,
  p_decision text,
  p_verified_views bigint,
  p_note text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  s public.influencer_submissions%rowtype;
  p public.influencer_packages%rowtype;
  v_week_start date;
  v_week_end date;
  v_week_earned numeric(18,2);
  v_reward numeric(18,2):=0;
  v_now timestamptz:=now();
begin
  if p_decision not in ('approved','rejected') or p_verified_views < 0 or length(trim(p_note)) < 3 then
    raise exception 'Datos de revisión inválidos.';
  end if;
  select * into s from public.influencer_submissions where id=p_submission_id for update;
  if not found or s.status <> 'pending' then raise exception 'La evidencia ya fue revisada o no existe.'; end if;
  select * into p from public.influencer_packages where id=s.package_id for update;
  if not found then raise exception 'El paquete no existe.'; end if;
  v_week_start := ((s.story_published_at at time zone 'America/Mexico_City')::date - (extract(isodow from s.story_published_at at time zone 'America/Mexico_City')::int - 1));
  v_week_end := v_week_start + 6;
  select coalesce(sum(reward_amount),0) into v_week_earned from public.influencer_submissions
   where package_id=p.id and status='approved'
     and (story_published_at at time zone 'America/Mexico_City')::date between v_week_start and v_week_end;
  if p_decision='approved' then
    v_reward := trunc(greatest(0,least(p_verified_views*p.reward_rate,p.weekly_cap-v_week_earned,p.reward_cap-p.earned_total)),2);
  end if;
  update public.influencer_submissions set status=p_decision,verified_views=p_verified_views,reward_amount=v_reward,
    reviewed_by=p_admin_id,reviewed_at=v_now,review_note=trim(p_note) where id=s.id;
  if p_decision='approved' then
    update public.influencer_packages set earned_total=earned_total+v_reward,verified_views=verified_views+p_verified_views,
      status=case when earned_total+v_reward>=reward_cap then 'completed' else status end,updated_at=v_now where id=p.id;
    insert into public.influencer_weekly_payouts(package_id,user_id,week_start,week_end,verified_views,amount,status)
    values(p.id,s.user_id,v_week_start,v_week_end,p_verified_views,v_reward,'pending')
    on conflict(package_id,week_start) do update set
      verified_views=public.influencer_weekly_payouts.verified_views+excluded.verified_views,
      amount=public.influencer_weekly_payouts.amount+excluded.amount;
  end if;
  return jsonb_build_object('id',s.id,'package_id',p.id,'user_id',s.user_id,'status',p_decision,'reward_amount',v_reward,'week_start',v_week_start);
end;
$$;
revoke all on function public.admin_review_influencer_submission(uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.admin_review_influencer_submission(uuid,uuid,text,bigint,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('influencer-evidence','influencer-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Files are written and read through short-lived signed URLs issued by the server.
-- No direct authenticated storage policy is intentionally granted.

notify pgrst,'reload schema';
commit;
