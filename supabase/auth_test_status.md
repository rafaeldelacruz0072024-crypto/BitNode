# Estado de prueba de Supabase Auth

- Proyecto: `bitnode`, ref. `kmiuwbnduedaqpaytbhz`.
- `public.profiles` existe.
- Trigger confirmado: `on_auth_user_created`.
- Políticas RLS confirmadas: `profiles_insert_own`, `profiles_select_own`, `profiles_update_own` para `authenticated`.
- Cuenta existente corregida: `gentecash+1@gmail.com` usa `gentecash_2`.
- Cuenta adicional detectada en Auth: `gentecash4+@gmail.com`, distinta de `gentecash+4@gmail.com`.
- En Supabase Authentication > Sign In / Providers se desactivó temporalmente `Confirm email` y se guardó el cambio para pruebas.
- Pendiente: probar registro/login desde `https://bit-node.vercel.app/auth` y reactivar `Confirm email` antes de usar fondos reales.
