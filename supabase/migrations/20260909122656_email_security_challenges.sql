create table public.email_security_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('withdrawal', 'wallet_change')),
  code_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_security_challenges_lookup_idx
  on public.email_security_challenges(user_id, purpose, created_at desc);
alter table public.email_security_challenges enable row level security;
revoke all on public.email_security_challenges from public, anon, authenticated;

create table public.transactional_email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind = 'welcome'),
  provider_id text,
  created_at timestamptz not null default now(),
  unique(user_id, kind)
);
alter table public.transactional_email_events enable row level security;
revoke all on public.transactional_email_events from public, anon, authenticated;
