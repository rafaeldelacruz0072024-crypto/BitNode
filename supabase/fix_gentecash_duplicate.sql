-- Corrección controlada del segundo username duplicado.
-- No elimina usuarios ni cambia contraseñas.
-- Conserva gentecash para la cuenta original y asigna gentecash_2 a la segunda.

begin;

insert into public.profiles (id, username, display_name)
values (
  'd2e15826-6d03-48c0-8b28-504d833cf176'::uuid,
  'gentecash_2',
  null
)
on conflict (id) do update
set username = 'gentecash_2',
    updated_at = now();

commit;

-- Verificación: debe devolver dos usernames distintos.
select p.id, p.username, u.email
from public.profiles p
left join auth.users u on u.id = p.id
where p.id in (
  '1d49e94b-381e-41a3-92b8-7441d0f6508e'::uuid,
  'd2e15826-6d03-48c0-8b28-504d833cf176'::uuid
)
order by p.created_at;

-- Verificación de duplicados: debe devolver cero filas.
select lower(username) as username, count(*) as total
from public.profiles
where username is not null
group by lower(username)
having count(*) > 1;
