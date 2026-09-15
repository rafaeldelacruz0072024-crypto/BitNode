-- Idempotent production role assignment for the requested existing account.
-- Run in the BitNode project SQL Editor; no new auth user is created.
do $grant_admin$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users
  where lower(email) = 'luis-nug1943@outlook.com';
  if v_user_id is null then
    raise exception 'No existe luis-nug1943@outlook.com en auth.users';
  end if;

  update public.profiles set role = 'admin', updated_at = now()
  where id = v_user_id and role is distinct from 'admin';

  if not exists (select 1 from public.profiles
    where id = v_user_id and role = 'admin') then
    raise exception 'No existe el perfil o no se aplicó el rol admin';
  end if;
end;
$grant_admin$;

select lower(u.email) as email, p.username, p.role
from auth.users u join public.profiles p on p.id = u.id
where lower(u.email) = 'luis-nug1943@outlook.com';
