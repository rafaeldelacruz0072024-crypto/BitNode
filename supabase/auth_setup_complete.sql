-- BitNode · Auth Supabase: perfiles, trigger y RLS
-- Ejecutar completo en Supabase SQL Editor.
-- No elimina tablas ni datos existentes.

begin;

-- 1) La tabla debe existir antes de cualquier función o INSERT.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text,
  sponsor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists sponsor_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create unique index if not exists profiles_username_unique_idx
on public.profiles (lower(username))
where username is not null;

create index if not exists profiles_sponsor_idx
on public.profiles (sponsor_id);

-- 2) Actualización automática de updated_at.
create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
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

-- 3) Crear el perfil al registrar un usuario en Supabase Auth.
-- Si el username ya está ocupado, se guarda NULL y el registro no falla.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
  requested_display_name text;
  safe_username text;
begin
  requested_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  requested_display_name := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name'
  )), '');

  safe_username := requested_username;
  if safe_username is not null and exists (
    select 1 from public.profiles p
    where lower(p.username) = lower(safe_username)
      and p.id <> new.id
  ) then
    safe_username := null;
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, safe_username, requested_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) Sincronizar usuarios existentes sin colisionar con usernames ocupados.
insert into public.profiles (id, username, display_name)
select
  u.id,
  case
    when nullif(trim(u.raw_user_meta_data ->> 'username'), '') is null then null
    when exists (
      select 1 from public.profiles p2
      where lower(p2.username) = lower(nullif(trim(u.raw_user_meta_data ->> 'username'), ''))
        and p2.id <> u.id
    ) then null
    else nullif(trim(u.raw_user_meta_data ->> 'username'), '')
  end,
  nullif(trim(coalesce(
    u.raw_user_meta_data ->> 'display_name',
    u.raw_user_meta_data ->> 'full_name'
  )), '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- 5) RLS: cada usuario solo puede consultar y modificar su propio perfil.
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select to authenticated
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles for insert to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;

commit;

-- Verificaciones, ejecutar aparte después del bloque anterior:
-- select to_regclass('public.profiles');
-- select id, username, display_name from public.profiles order by created_at desc limit 20;
-- select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- select policyname, roles, cmd from pg_policies where tablename = 'profiles' order by policyname;
