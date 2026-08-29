-- BitNode: modelo persistente de identidad, planes, contratos y red.
-- Ejecutar después de habilitar Supabase Auth y antes de activar comisiones.
-- La migración es idempotente y no inserta datos de prueba.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade
);

-- Compatibilidad con una tabla profiles creada anteriormente.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists sponsor_id uuid;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists updated_at timestamptz default now();

-- Solo rellena perfiles existentes que todavía no tengan identidad comercial.
update public.profiles
set username = 'user_' || replace(left(id::text, 13), '-', '')
where nullif(trim(username), '') is null;

update public.profiles
set referral_code = lower(replace(left(id::text, 13), '-', ''))
where nullif(trim(referral_code), '') is null;

alter table public.profiles alter column username set not null;
alter table public.profiles alter column referral_code set not null;
alter table public.profiles alter column created_at set default now();
alter table public.profiles alter column updated_at set default now();

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));
create unique index if not exists profiles_referral_code_lower_unique
  on public.profiles (lower(referral_code));
create index if not exists profiles_sponsor_idx on public.profiles(sponsor_id);

create or replace function public.create_profile(
  p_username text,
  p_referral_code text default null,
  p_sponsor_referral_code text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_sponsor_id uuid;
  v_referral_code text := lower(trim(coalesce(nullif(p_referral_code, ''), p_username)));
begin
  if auth.uid() is null then raise exception 'Authenticated user is required'; end if;
  if nullif(trim(p_username), '') is null then raise exception 'Username is required'; end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if found then return v_profile; end if;

  if nullif(trim(p_sponsor_referral_code), '') is not null then
    select id into v_sponsor_id
    from public.profiles
    where lower(referral_code) = lower(trim(p_sponsor_referral_code));
    if v_sponsor_id is null then raise exception 'Sponsor referral code not found'; end if;
  end if;

  insert into public.profiles(id, username, referral_code, sponsor_id)
  values (auth.uid(), trim(p_username), v_referral_code, v_sponsor_id)
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_profiles_updated_at();

create table if not exists public.plans (
  id text primary key,
  name text not null,
  slug text not null unique,
  rate_min numeric(8,6) not null check (rate_min >= 0 and rate_min <= 1),
  rate_max numeric(8,6) not null check (rate_max >= rate_min and rate_max <= 1),
  cadence text not null default 'business_days',
  duration_days integer check (duration_days is null or duration_days > 0),
  min_amount numeric(18,8) not null check (min_amount > 0),
  principal_returned boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists plans_name_unique on public.plans(lower(name));

create table if not exists public.contracts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  plan_id text not null references public.plans(id) on delete restrict,
  amount numeric(18,8) not null check (amount > 0),
  status text not null default 'active' check (status in ('pending', 'active', 'completed', 'cancelled', 'expired', 'reversed')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  principal_returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create index if not exists contracts_user_created_idx on public.contracts(user_id, created_at desc);
create index if not exists contracts_plan_idx on public.contracts(plan_id);
create index if not exists contracts_status_idx on public.contracts(status);

create or replace function public.set_contracts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contracts_set_updated_at on public.contracts;
create trigger contracts_set_updated_at
before update on public.contracts
for each row execute function public.set_contracts_updated_at();

-- Compatible con la tabla network_nodes existente de commissions.sql.
-- La posición binaria sigue siendo independiente del plan contratado.
create table if not exists public.network_nodes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sponsor_id uuid references auth.users(id) on delete restrict,
  parent_id uuid references auth.users(id) on delete restrict,
  leg text check (leg in ('left', 'right')),
  created_at timestamptz not null default now(),
  constraint network_nodes_parent_leg_unique unique (parent_id, leg),
  constraint network_nodes_leg_parent_check check ((parent_id is null and leg is null) or (parent_id is not null and leg is not null)),
  constraint network_nodes_not_self_sponsor check (sponsor_id is null or sponsor_id <> user_id),
  constraint network_nodes_not_self_parent check (parent_id is null or parent_id <> user_id)
);

create index if not exists network_nodes_sponsor_idx on public.network_nodes(sponsor_id);
create index if not exists network_nodes_parent_idx on public.network_nodes(parent_id);

insert into public.plans (id, name, slug, rate_min, rate_max, cadence, duration_days, min_amount, principal_returned)
values
  ('daily', 'Nodo Diario', 'nodo-diario', 0.01, 0.015, 'business_days', null, 10, false),
  ('7d', 'Nodo 7 Días', 'nodo-7-dias', 0.02, 0.03, 'business_days', 7, 10, true),
  ('14d', 'Nodo 14 Días', 'nodo-14-dias', 0.03, 0.04, 'business_days', 14, 10, true),
  ('21d', 'Nodo 21 Días', 'nodo-21-dias', 0.04, 0.05, 'business_days', 21, 10, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  rate_min = excluded.rate_min,
  rate_max = excluded.rate_max,
  cadence = excluded.cadence,
  duration_days = excluded.duration_days,
  min_amount = excluded.min_amount,
  principal_returned = excluded.principal_returned,
  updated_at = now();

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.contracts enable row level security;
alter table public.network_nodes enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid() or sponsor_id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

revoke all on function public.create_profile(text, text, text) from public;
grant execute on function public.create_profile(text, text, text) to authenticated;

drop policy if exists plans_select_active on public.plans;
create policy plans_select_active on public.plans for select to authenticated using (active = true);

drop policy if exists contracts_select_own on public.contracts;
create policy contracts_select_own on public.contracts for select to authenticated using (user_id = auth.uid());

drop policy if exists network_nodes_select_related on public.network_nodes;
create policy network_nodes_select_related on public.network_nodes for select to authenticated using (user_id = auth.uid() or sponsor_id = auth.uid() or parent_id = auth.uid());

revoke all on table public.profiles, public.plans, public.contracts, public.network_nodes from anon;
grant select on public.profiles to authenticated;
grant select on public.plans to authenticated;
grant select on public.contracts, public.network_nodes to authenticated;
