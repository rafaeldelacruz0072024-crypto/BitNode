# Integración full-stack de BitNode

## Alcance

El proyecto debe evolucionar desde una réplica estática hacia una aplicación interactiva con cuentas de usuario, dashboard persistente, contratos, movimientos y una integración de pago segura. El orden acordado es repositorio GitHub, despliegue Vercel, backend Supabase y pasarela de pago al final.

## Tareas pendientes

- [x] Leer las guías de conectores y automatización aplicables.
- [x] Auditar las conexiones disponibles para GitHub, Vercel, Supabase y pagos.
- [x] Confirmar que las integraciones externas quedan pospuestas temporalmente y que el trabajo continúa localmente.
- [x] Preparar la aplicación local con interfaces desacopladas para backend, sin perder la réplica visual.
- [x] Definir el modelo local de usuarios, perfiles, contratos, nodos, movimientos, bonos y rangos.
- [ ] Pospuesto: configurar el repositorio GitHub y documentar el flujo de ramas.
- [ ] Pospuesto: configurar Vercel y variables de entorno sin exponer secretos.
- [ ] Pospuesto: integrar Supabase Auth, tablas, políticas RLS y funciones de servidor.
- [ ] Pospuesto: diseñar la pasarela de pago y validar primero en modo sandbox/test.
- [ ] Verificar seguridad, responsive, errores y flujos críticos antes de publicar; pendiente de backend real.

## Mejora actual: depósitos y retiros

- [x] Validar monto numérico, mínimo de depósito y balance disponible para retiros.
- [x] Bloquear el envío mientras el formulario tenga errores.
- [x] Mostrar un diálogo de confirmación antes de procesar cada operación.
- [x] Permitir cancelar la operación sin modificar el balance.
- [x] Mostrar mensajes diferenciados de éxito, error y estado pendiente.

## Mejora actual: retiros, wallets y Supabase

- [x] Definir límite diario local inicial de retiros y suma de retiros confirmados del día.
- [x] Calcular comisión automática antes de abrir la confirmación.
- [x] Validar formato de wallet según la red seleccionada.
- [x] Añadir selector de red y mostrar resumen bruto, comisión y neto.
- [x] Diseñar registro de transacción para depósito y retiro.
- [x] Conectar persistencia real con Supabase; tabla y RLS aplicadas, escritura y lectura verificadas con la publishable key moderna.
- [ ] Verificar historial, errores, límites y responsive.

## Mejora actual: RLS, prueba e historial remoto

- [x] Aplicar políticas RLS de inserción y lectura para `transactions`.
- [x] Crear índice por usuario y fecha.
- [x] Insertar un depósito de prueba controlado y comprobarlo por REST; registro `TEST-DEP-GENTECASH-006` confirmado con HTTP 201.
- [x] Mostrar estado de conexión remota y transacciones en Historial.
- [x] Verificar que no se dupliquen movimientos locales y remotos.
