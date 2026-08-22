-- Diagnóstico seguro: solo SELECT, no modifica datos.

-- 1) Perfil que actualmente ocupa gentecash.
select id, username, display_name, created_at, updated_at
from public.profiles
where lower(username) = 'gentecash';

-- 2) Usuario(s) de Supabase Auth cuyo metadata contiene gentecash.
select
  id,
  email,
  created_at,
  raw_user_meta_data ->> 'username' as username,
  raw_user_meta_data ->> 'display_name' as display_name
from auth.users
where lower(trim(raw_user_meta_data ->> 'username')) = 'gentecash'
order by created_at, id;

-- 3) Todos los usernames repetidos en Auth metadata.
select
  lower(trim(raw_user_meta_data ->> 'username')) as username,
  count(*) as total
from auth.users
where nullif(trim(raw_user_meta_data ->> 'username'), '') is not null
group by lower(trim(raw_user_meta_data ->> 'username'))
having count(*) > 1
order by total desc, username;

-- 4) Confirmar que profiles no tenga duplicados.
select lower(username) as username, count(*) as total
from public.profiles
where username is not null
group by lower(username)
having count(*) > 1;
