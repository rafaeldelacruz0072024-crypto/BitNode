-- BitNode · Corrección del conflicto de username duplicado
-- El error ocurre porque gentecash ya existe en profiles y el índice
-- profiles_username_unique_idx impide insertar otra fila con el mismo nombre.
-- Este parche no elimina ni sobrescribe perfiles existentes.

begin;

-- 1) Reemplaza el trigger para que un username ocupado se guarde como NULL
-- en vez de abortar el registro del usuario nuevo.
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
    select 1
    from public.profiles p
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

-- 2) Reintenta la sincronización de usuarios existentes sin provocar
-- conflicto: si el username ya pertenece a otro perfil, conserva el perfil
-- existente y deja NULL para el usuario que no puede usarlo.
insert into public.profiles (id, username, display_name)
select
  u.id,
  case
    when nullif(trim(u.raw_user_meta_data ->> 'username'), '') is null then null
    when exists (
      select 1
      from public.profiles p2
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
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;

commit;

-- Verificación:
-- select id, username, display_name from public.profiles order by created_at desc;
-- select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
