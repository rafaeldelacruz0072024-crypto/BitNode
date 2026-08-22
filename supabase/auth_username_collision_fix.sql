-- BitNode · Corrección definitiva de usernames duplicados
-- Ejecutar después de que public.profiles ya exista.
-- No elimina perfiles ni usernames existentes.

begin;

-- El trigger tolera tanto duplicados existentes como carreras concurrentes.
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

  begin
    insert into public.profiles (id, username, display_name)
    values (new.id, safe_username, requested_display_name)
    on conflict (id) do nothing;
  exception when unique_violation then
    -- Si otro registro ocupó el username entre la comprobación y el INSERT,
    -- se conserva el usuario y se crea su perfil sin username.
    insert into public.profiles (id, username, display_name)
    values (new.id, null, requested_display_name)
    on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- La consulta anterior fallaba si dos usuarios de auth.users tenían el mismo
-- username. Aquí solo se conserva el primero; los demás quedan con NULL.
with candidates as (
  select
    u.id,
    nullif(trim(u.raw_user_meta_data ->> 'username'), '') as requested_username,
    nullif(trim(coalesce(
      u.raw_user_meta_data ->> 'display_name',
      u.raw_user_meta_data ->> 'full_name'
    )), '') as requested_display_name,
    row_number() over (
      partition by lower(nullif(trim(u.raw_user_meta_data ->> 'username'), ''))
      order by u.created_at, u.id
    ) as username_order
  from auth.users u
  where not exists (
    select 1 from public.profiles p where p.id = u.id
  )
), prepared as (
  select
    c.id,
    case
      when c.requested_username is null then null
      when c.username_order > 1 then null
      when exists (
        select 1 from public.profiles p
        where lower(p.username) = lower(c.requested_username)
      ) then null
      else c.requested_username
    end as username,
    c.requested_display_name
  from candidates c
)
insert into public.profiles (id, username, display_name)
select id, username, requested_display_name
from prepared
on conflict (id) do nothing;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;

commit;

-- Verificación:
-- select id, username, display_name from public.profiles order by created_at desc;
-- select lower(username), count(*) from public.profiles where username is not null group by lower(username) having count(*) > 1;
