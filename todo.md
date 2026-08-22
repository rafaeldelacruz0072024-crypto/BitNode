
## Restauración solicitada: estado anterior al admin

- [x] Restaurar el código al commit estable `63ff3a1`, inmediatamente anterior al dashboard interno administrativo.
- [x] Conservar intactos los datos y el esquema remoto de Supabase; no ejecutar SQL destructivo.
- [x] Verificar `pnpm check`, `pnpm build`, landing y que `/dashboard` devuelve 404; el estado anterior no contiene suite `test`, Auth Supabase ni endpoints financieros.
- [x] Documentar la versión restaurada y las diferencias respecto al estado posterior en `RESTORATION.md`.

## Diagnóstico de logs Vercel adjuntos

- [ ] Resolver `ERR_MODULE_NOT_FOUND` por importación de `drizzle/schema` sin extensión en el bundle ESM.
- [ ] Resolver `Dynamic require of "path" is not supported` causado por Express dentro del bundle ESM.
- [ ] Mantener la landing restaurada anterior al admin sin reemplazarla mientras se corrige la variante serverless.
- [ ] Validar el endpoint de producción después de la corrección serverless.

## Rama experimental: panel administrativo con Vercel nativo

- [x] Crear la rama aislada `feature/admin-vercel-native` desde la versión estable `6ca3822`.
- [x] Evaluar `DashboardLayout`; no existe en el commit base restaurado, por lo que se creó un layout aislado sin tocar la landing pública.
- [ ] Integrar protección de la ruta visual por sesión/rol; la función API ya exige `ADMIN_API_KEY` y el panel permanece en modo seguro de prueba.
- [x] Crear `api/admin.ts` como función nativa de Vercel, sin Express, `listen()` ni bundle ESM incompatible.
- [x] Añadir cuatro pruebas Vitest para autorización, método HTTP y respuesta read-only de la función API.
- [x] Validar `pnpm check`, `pnpm test`, `pnpm build`, preview de landing/panel y responsive móvil; el endpoint local queda bloqueado sin credencial, como estaba diseñado.
