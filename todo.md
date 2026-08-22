
## Restauración solicitada: estado anterior al admin

- [x] Restaurar el código al commit estable `63ff3a1`, inmediatamente anterior al dashboard interno administrativo.
- [x] Conservar intactos los datos y el esquema remoto de Supabase; no ejecutar SQL destructivo.
- [x] Verificar `pnpm check`, `pnpm build`, landing y que `/dashboard` devuelve 404; el estado anterior no contiene suite `test`, Auth Supabase ni endpoints financieros.
- [x] Documentar la versión restaurada y las diferencias respecto al estado posterior en `RESTORATION.md`.
