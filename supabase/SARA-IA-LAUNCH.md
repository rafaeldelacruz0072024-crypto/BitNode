# SARA IA — lanzamiento del 5 de octubre de 2026

Estado: implementado y probado localmente; pendiente de aplicación SQL y verificación en producción.

1. Aplicar `migrations/20261002201950_sara_ia_subscription_and_autopilot.sql` en el proyecto BitNode `kmiuwbnduedaqpaytbhz`. La migración es transaccional y puede volver a ejecutarse; requiere las tablas y RPC de tareas existentes y pg_cron.
2. Ejecutar `verify-sara-ia.sql`. Confirmar RLS, permisos internos y el trabajo activo `bitnode-sara-ia-weekday-tasks`.
3. Publicar la rama `codex/sara-ia` tras la aprobación de publicación y comprobar las variables servidor de Supabase y NOWPayments y el webhook firmado existente.
4. Antes del lunes, verificar que contratar devuelve bloqueo por fecha. Desde el lunes, comprobar con una cuenta de prueba autorizada el flujo real de pago, suscripción, tareas y ledger; no asumir que las pruebas locales sustituyen ese control.

La contratación y el ejecutor se habilitan desde el lunes 5 a las 00:00 de Santo Domingo. Precio: 25 USD mensuales, USDT BEP20 o TRC20, renovación manual. No se carga la billetera ni se generan depósitos por el pago del servicio.

Requiere nodo de 21 días activo sobre un plan habilitado. Si pierde ese nodo, las tareas se suspenden; la fecha de vencimiento de la suscripción no se pausa.

El cron despierta cada cinco minutos, pero el ejecutor solo realiza tareas de lunes a viernes en Santo Domingo. Respeta las 24 horas iniciales y el ciclo vigente. Usa el RPC existente para las cuatro tareas y conserva sus reglas de rendimiento. Verifica las cuatro claves antes de registrar éxito, evita duplicar ejecuciones exitosas y permite reintentar fallos. La ejecución fallida revierte las tareas de ese intento en la subtransacción.

Pruebas locales: TypeScript, servidor SARA y `scripts/test-sara-ia-sql.mjs` con PGlite. Esta última prueba usa reloj, RPC de tareas y cron simulados; no prueba NOWPayments ni el motor productivo real.
