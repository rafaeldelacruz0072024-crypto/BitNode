
## Restauración solicitada: estado anterior al admin

- [x] Restaurar el código al commit estable `63ff3a1`, inmediatamente anterior al dashboard interno administrativo.
- [x] Conservar intactos los datos y el esquema remoto de Supabase; no ejecutar SQL destructivo.
- [x] Verificar `pnpm check`, `pnpm build`, landing y que `/dashboard` devuelve 404; el estado anterior no contiene suite `test`, Auth Supabase ni endpoints financieros.
- [x] Documentar la versión restaurada y las diferencias respecto al estado posterior en `RESTORATION.md`.

## Diagnóstico de logs Vercel adjuntos

- [x] Superseder `ERR_MODULE_NOT_FOUND` evitando el bundle ESM de la variante anterior; la rama nativa no importa `drizzle/schema`.
- [x] Superseder `Dynamic require of "path" is not supported` eliminando Express del handler nativo de Vercel.
- [x] Mantener la landing restaurada en `/`; el panel experimental vive únicamente en `/admin` dentro de esta rama.
- [x] Validar localmente la función nativa mediante cuatro pruebas de autorización; el endpoint de producción queda pendiente de configurar `ADMIN_API_KEY` en Vercel.

## Rama experimental: panel administrativo con Vercel nativo

- [x] Crear la rama aislada `feature/admin-vercel-native` desde la versión estable `6ca3822`.
- [x] Evaluar `DashboardLayout`; no existe en el commit base restaurado, por lo que se creó un layout aislado sin tocar la landing pública.
- [x] Proteger el acceso visual mediante validación contra `/api/admin` y `ADMIN_API_KEY`; integrar sesión/rol Supabase queda fuera de este primer prototipo.
- [x] Crear `api/admin.ts` como función nativa de Vercel, sin Express, `listen()` ni bundle ESM incompatible.
- [x] Añadir cuatro pruebas Vitest para autorización, método HTTP y respuesta read-only de la función API.
- [x] Validar `pnpm check`, `pnpm test`, `pnpm build`, preview de landing/panel y responsive móvil; el endpoint local queda bloqueado sin credencial, como estaba diseñado.
