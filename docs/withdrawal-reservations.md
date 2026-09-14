# Reservas de retiros

La confirmación por correo crea el retiro pendiente y reserva su monto bruto en una sola transacción. La ventana administrativa, el saldo disponible y el límite diario se comprueban antes de enviar el código y nuevamente al reservar. La comisión sigue siendo 5%, con mínimo de 1 USDT; red USDT BEP20, mínimo 10 y máximo diario 1000 USDT por día UTC.

El saldo disponible suma movimientos completados y descuenta retiros pendientes/aprobados. Aprobar y pagar conservan el mismo descuento; rechazar libera la reserva. Los retiros rechazados siguen contando para el límite diario, como antes. El servidor devuelve el saldo calculado sobre todo el historial, aunque la pantalla solo reciba los últimos 200 movimientos.

`guard_reserved_ledger` bloquea la fila del perfil durante las escrituras que afectan su saldo. También impide que una activación de nodo use el saldo reservado y rechaza cambios de monto, wallet o red en retiros confirmados. Las escrituras directas del cliente sobre el ledger quedan revocadas. Un código consumido puede reintentarse: el RPC devuelve la solicitud existente sin otro descuento.

## Instalación y verificación

- Migración: `supabase/migrations/20260914155545_reserve_verified_withdrawals.sql`.
- Proyecto objetivo: BitNode, `kmiuwbnduedaqpaytbhz`.
- Aplicar la migración antes de publicar el servidor y la interfaz nuevos.
- `supabase/verify-withdrawal-reservations.sql` comprueba ventana, saldo, reserva, aprobación, pago, rechazo, repetición y protección contra gasto en nodos. Todas las escrituras de prueba se revierten; no envía correos ni fondos.
- Prueba aislada: `node scripts/test-withdrawal-reservations-sql.mjs /ruta/a/@electric-sql/pglite/dist/index.js`.

Validación del 14 de septiembre de 2026: TypeScript y compilación correctos; 68 pruebas automáticas pasaron. Dos pruebas de credenciales externas no pudieron pasar por ausencia local de `SUPABASE_SERVICE_ROLE_KEY` y `NOWPAYMENTS_API_KEY`. La migración y la prueba reversible también pasaron en el esquema real de BitNode antes de aplicarse definitivamente. No había retiros existentes ni saldos negativos tras calcular las reservas. La ventana administrativa estaba abierta y se conserva su configuración.

Esta validación no realiza un envío real de USDT ni comprueba la entrega de un nuevo código por correo. El administrador sigue procesando los pagos manualmente.
