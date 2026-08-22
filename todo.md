
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

## Protección del panel con Supabase Auth y roles

- [x] Crear cliente Supabase browser usando únicamente variables públicas VITE.
- [x] Validar la integración server-side contra la estructura real: `profiles.role` ya existe; ningún usuario ha sido promovido automáticamente, por lo que el acceso seguirá en 403 hasta asignar un admin explícitamente.
- [x] Sustituir el formulario de API key por login/logout de Supabase y estados de acceso 401/403/503.
- [x] Añadir pruebas mock para sesión ausente, token inválido, usuario no admin y admin autorizado.
- [ ] Ejecutar smoke test real con una sesión Supabase admin después de promover explícitamente un perfil.
- [x] Verificar build, pruebas, flujo responsive y esquema Supabase real.

## Comisión de indicación directa: 10%

- [x] Definir una única constante server-side de comisión directa igual a 10% en `server/commissionRules.ts`.
- [x] Implementar cálculo de comisión directa con redondeo a 8 decimales y validación de monto positivo.
- [x] Mantener el crédito idempotente delegando desde `server/contractActivation.ts` en `process_contract_commissions`, que usa `source_event_id`, beneficiario, tipo `direct` y conflicto único.
- [x] Validar en el RPC Supabase existente que el directo se acredita únicamente a `network_nodes.sponsor_id`; el binario usa una ruta separada.
- [x] Añadir pruebas de cálculo, redondeo, monto inválido, llamada al RPC, idempotencia y bloqueo de contratos no confirmados.
- [x] Validar por arquitectura y pruebas que el navegador no acredita fondos: sólo el flujo server-side de contrato confirmado llama al RPC y conserva el binario independiente del directo.
