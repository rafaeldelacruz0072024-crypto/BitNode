-- BitNode · Configuración segura de perfiles para Supabase Auth
-- Ejecutar en Supabase Dashboard → SQL Editor.
-- Este script no borra tablas ni datos existentes.

begin;

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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Sincroniza usuarios que ya existían antes de instalar el trigger.
insert into public.profiles (id, username, display_name)
select
  u.id,
  nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
  nullif(trim(coalesce(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name')), '')
from auth.users as u
on conflict (id) do update
set username = coalesce(public.profiles.username, excluded.username),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

-- Permisos mínimos: el cliente autenticado usa RLS; la función de trigger
-- mantiene permisos de su propietario y no se expone como endpoint RPC.
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;

commit;

-- Verificación posterior, ejecutar como consultas separadas:
-- select id, username, display_name from public.profiles order by created_at desc limit 10;
-- select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- select schemaname, tablename, policyname, roles, cmd from pg_policies where tablename = 'profiles';
