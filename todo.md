
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
- [x] Ejecutar smoke test real con la sesión Supabase admin de gentecash después de promover explícitamente el perfil.
- [x] Verificar build, pruebas, flujo responsive y esquema Supabase real.

## Comisión de indicación directa: 10%

- [x] Definir una única constante server-side de comisión directa igual a 10% en `server/commissionRules.ts`.
- [x] Implementar cálculo de comisión directa con redondeo a 8 decimales y validación de monto positivo.
- [x] Mantener el crédito idempotente delegando desde `server/contractActivation.ts` en `process_contract_commissions`, que usa `source_event_id`, beneficiario, tipo `direct` y conflicto único.
- [x] Validar en el RPC Supabase existente que el directo se acredita únicamente a `network_nodes.sponsor_id`; el binario usa una ruta separada.
- [x] Añadir pruebas de cálculo, redondeo, monto inválido, llamada al RPC, idempotencia y bloqueo de contratos no confirmados.
- [x] Validar por arquitectura y pruebas que el navegador no acredita fondos: sólo el flujo server-side de contrato confirmado llama al RPC y conserva el binario independiente del directo.

## Consolidación solicitada

- [x] Revisar y consolidar todos los cambios actuales de `feature/admin-vercel-native` en un commit versionado, sin implementar funcionalidades nuevas.
- [x] Confirmar que `main` permanece sin modificaciones y entregar la referencia del commit/checkpoint.

## Bono binario 10% en backend y frontend

- [x] Centralizar la tasa binaria en 10% en `server/binaryCommission.ts` y conservar el emparejamiento izquierda/derecha.
- [x] Conectar el flujo server-side de contratos confirmados al adaptador de comisiones; el navegador sólo consulta el endpoint protegido.
- [x] Exponer métricas seguras mediante `api/commissions/summary.ts`, con validación de sesión y rol admin.
- [x] Mostrar en el frontend el bono binario 10%, volumen por pierna y estado de emparejamiento.
- [x] Añadir pruebas específicas de tasa 10%, emparejamiento, delta, redondeo, idempotencia, 401/403/200 y separación directo/binario.
- [x] Validar `pnpm check`, 22 pruebas, `pnpm build`, responsive y crear el commit final `81a719b` posterior a esta integración.

## Credencial administrativa autorizada

- [x] Restablecer la contraseña de `gentecash@gmail.com` mediante la API administrativa segura de Supabase, sin escribirla en código, logs o repositorio.
- [x] Verificar login real HTTP 200 y rol `admin` en Supabase sin exponer contraseña; el acceso visual en `/admin` queda listo para comprobarse con esa sesión.

## Diagnóstico de autorización admin real

- [x] Comparar el UUID del access token con `public.profiles.id`; el token real corresponde a `1d49e94b-381e-41a3-92b8-7441d0f6508e` y el rol devuelto es `admin`.
- [x] Confirmar que la función consulta el proyecto `kmiuwbnduedaqpaytbhz` y usa la clave service-role correcta.
- [x] Corregir el rechazo: el middleware local no adaptaba `ServerResponse` al contrato Vercel y provocaba 404/crash; se corrigió sin cambiar permisos.
- [x] Repetir la prueba visual con `gentecash@gmail.com`: panel visible, `Función protegida activa`, `gentecash@gmail.com · admin` y bono binario 10% cargado.

## Corrección del smoke test admin local

- [x] Conectar las funciones nativas `api/admin.ts` y `api/commissions/summary.ts` al servidor de desarrollo para evitar 404 en `/api/*`.
- [x] Mantener respuestas diferenciadas: 401 para sesión, 403 para rol, 503 para disponibilidad; el frontend muestra el estado correspondiente.
- [x] Repetir el login real y comprobar acceso admin después de recibir 200 del handler nativo.

- [x] Validación final posterior al arreglo: `pnpm check`, 22 pruebas Vitest y `pnpm build` pasan; panel admin real visible con `admin` y bono binario 10%.

## Publicación GitHub y Vercel

- [x] Confirmar rama actual, commit final y remoto GitHub sin cambios pendientes.
- [x] Subir `feature/admin-vercel-native` al repositorio GitHub configurado; rama creada en GitHub desde la copia Windows.
- [x] Verificar que Vercel detecte la rama; el preview fue creado y la landing carga, pero requiere redeploy con el fallback SPA.
- [x] Probar landing, `/admin` y endpoints nativos en el nuevo deployment de Vercel después del fix SPA: landing y `/admin` cargan en `bit-node.vercel.app`; `/api/commissions/summary` responde 401 controlado sin sesión.

## Publicación desde copia local de Windows

- [x] Comparar ramas y commits de `C:\Users\TECH-G\Documents\GitHub\BitNode` con la rama experimental del proyecto.
- [x] Recuperar la rama experimental sin sobrescribir cambios locales ni usar `reset --hard`.
- [x] Publicar la rama correcta a GitHub y verificar que Vercel la detecte.

## Corrección de rutas SPA en Vercel

- [x] Añadir fallback SPA específico para `/admin`, `/dashboard` y `/auth` sin interceptar `/api/*`.
- [x] Publicar la corrección del endpoint de resumen y volver a probar el preview; el Preview y Production quedaron en estado Ready.
- [ ] Diagnosticar `Invalid login credentials` en `/admin` del Preview de Vercel y verificar que URL, clave pública, usuario y contraseña pertenezcan al mismo proyecto Supabase.
- [ ] Repetir el smoke test administrativo después de corregir la configuración o las credenciales, sin exponer secretos.
- [ ] Marcar el endpoint de resumen y la validación de producción como completados solo después de observar respuestas 401/403/200 controladas en Vercel.
- [x] Probar directamente `https://bit-node.vercel.app/api/admin` en Production: responde `401` JSON con `status: unauthenticated`, sin 404 ni crash.
- [ ] Completar el smoke test de `/admin` en Production con una sesión admin válida y confirmar que las métricas protegidas cargan sin errores.

## Ampliación del panel administrativo solicitada

- [x] Auditar el panel `/admin` actual y conservar la protección Supabase Auth + rol admin.
- [x] Añadir navegación interna para Resumen, Usuarios, Contratos, Transacciones y Comisiones.
- [x] Conectar métricas de resumen a datos reales y mostrar estados de carga, vacío y error.
- [x] Añadir tabla read-only de usuarios con búsqueda, rol, estado y fecha de registro.
- [x] Añadir tabla read-only de contratos con usuario, ciclo, monto, estado y fechas.
- [x] Añadir tabla read-only de transacciones con tipo, monto, estado, red, wallet y fecha.
- [x] Añadir sección de comisiones directas/binarias con tasas, volumen y ledger reciente.
- [x] Mantener todas las consultas administrativas server-side y read-only, sin acreditar fondos ni modificar datos.
- [x] Añadir pruebas Vitest para autorización, consultas, filtros, errores y estados vacíos.
- [x] Validar `pnpm check`, `pnpm test`, `pnpm build` y vista responsive del panel antes del checkpoint; localmente pasan 25 pruebas y el Preview responde 401 controlado en `/api/admin/data`.
- [x] Añadir una columna/indicador de estado de usuario usando `email_confirmed_at` y `banned_until` de Supabase Auth.
- [x] Completar contratos con ciclo explícito y fechas disponibles; `cycle` usa el label real y `startAt` la fecha registrada; `endAt` queda `—` porque no existe en el esquema actual.
- [x] Mostrar el tipo como columna visible en la tabla general de transacciones.
- [x] Añadir pruebas verificables para filtros, estados vacíos y errores del panel; `adminUtils.test.ts` cubre filtros/estado vacío y `data.test.ts` cubre 503.
- [x] Validar el panel ampliado en viewport móvil/tablet y registrar evidencia; `/admin` y la landing se capturaron a 375×812.
- [x] Añadir pruebas UI/integración del panel `/admin` para filtro, estado vacío y error renderizado; 3 casos pasan en JSDOM.
- [x] Validar `/admin` en viewport tablet adicional de 768×1024 y registrar evidencia; la puerta de acceso fue capturada.
- [ ] Revisar visualmente la captura tablet y, si es posible, validar también la vista autenticada del panel ampliado en 768×1024 antes del checkpoint.
