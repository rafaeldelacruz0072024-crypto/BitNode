# Integración full-stack de BitNode

## Alcance

El proyecto debe evolucionar desde una réplica estática hacia una aplicación interactiva con cuentas de usuario, dashboard persistente, contratos, movimientos y una integración de pago segura. El orden acordado es repositorio GitHub, despliegue Vercel, backend Supabase y pasarela de pago al final.

## Tareas pendientes

- [x] Leer las guías de conectores y automatización aplicables.
- [x] Auditar las conexiones disponibles para GitHub, Vercel, Supabase y pagos.
- [x] Confirmar que las integraciones externas quedan pospuestas temporalmente y que el trabajo continúa localmente.
- [x] Preparar la aplicación local con interfaces desacopladas para backend, sin perder la réplica visual.
- [x] Definir el modelo local de usuarios, perfiles, contratos, nodos, movimientos, bonos y rangos.
- [x] Pospuesto: configurar el repositorio GitHub y documentar el flujo de ramas; el conector no quedó disponible en la sesión.
- [x] Pospuesto: configurar Vercel y variables de entorno sin exponer secretos; se mantiene el hosting administrado del proyecto.
- [x] Integrar Supabase Auth, tablas, políticas RLS y funciones de servidor.
- [ ] Última etapa: terminar la pasarela de pago y validar invoice/IPN en modo sandbox/test; pospuesto por decisión del usuario.
- [ ] Verificar seguridad y flujos financieros en producción; no ejecutado todavía porque producción y pagos reales requieren credenciales/conectores válidos.

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
- [x] Conectar persistencia real con Supabase; tabla, RLS y migración por `user_id` aplicadas, escritura y lectura base verificadas.
- [x] Verificar historial, errores, límites y responsive.

## Nueva etapa: Auth, retiros reales y NOWPayments

- [x] Confirmar disponibilidad de Supabase Auth y definir migración de `username` a `user_id`.
- [x] Preparar upgrade full-stack y variables seguras de servidor.
- [x] Añadir login, registro, sesión y protección de rutas.
- [x] Migrar transacciones y políticas RLS para usar `auth.uid()`; migración ejecutada con éxito en Supabase.
- [x] Crear formulario de retiro con wallet, red, comisión y estado auditable; queda como pre-solicitud pendiente hasta integrar payout server-side.

## Actualización actual: ciclos y porcentajes

- [x] Actualizar catálogo a Nodo Diario 1%–1.5% diario, indefinido, mínimo $10 USDT.
- [x] Añadir Nodo 7 Días 2%–3% diario, devolución del capital, mínimo $10 USDT.
- [x] Añadir Nodo 14 Días 3%–4% diario, devolución del capital, mínimo $10 USDT.
- [x] Añadir Nodo 21 Días 4%–5% diario, devolución del capital, mínimo $10 USDT.
- [x] Retirar los ciclos anteriores de 17 y 33 días de las interfaces visibles.
- [x] Verificar landing, dashboard y responsive.
- [x] Investigar endpoint oficial, sandbox y callback/IPN de NOWPayments.
- [x] Solicitar la API key de prueba y el IPN secret de NOWPayments al usuario.
- [ ] Última etapa: implementar y verificar creación de invoices NOWPayments y callback IPN HMAC; callback HMAC ya probado, invoice pendiente.
- [ ] Última etapa: verificar flujo completo NOWPayments en modo prueba; pruebas unitarias/IPN pasan, invoice pendiente.

## Mejora actual: RLS, prueba e historial remoto

- [x] Aplicar políticas RLS de inserción y lectura para `transactions`.
- [x] Crear índice por usuario y fecha.
- [x] Insertar un depósito de prueba controlado y comprobarlo por REST; registro `TEST-DEP-GENTECASH-006` confirmado con HTTP 201.
- [x] Mostrar estado de conexión remota y transacciones en Historial.
- [x] Verificar que no se dupliquen movimientos locales y remotos.

## Cierre técnico pendiente

- [x] Verificar que el formulario de retiros quede explícitamente como pre-solicitud protegida, sin mutar balance como retiro real en servidor.
- [x] Añadir una prueba automatizada de firma IPN válida e inválida para NOWPayments.
- [x] Verificar historial, errores, límites y responsive con la configuración actual; build y capturas móviles confirmados.
- [x] Documentar que GitHub/Vercel siguen pospuestos y que NOWPayments permanece bloqueado hasta obtener una API key con permisos de invoice.

## Verificación específica pendiente

- [x] Verificar `/dashboard/history` con datos remotos/locales combinados y ausencia de duplicados; helper probado con prioridad remota y sin IDs repetidos.
- [x] Probar `/dashboard/withdraw` con wallet inválida, monto mínimo y límite diario excedido mediante pruebas server-side.
- [x] Revisar en móvil `/dashboard/withdraw`, `/dashboard/history` y `/dashboard/deposit` después de Auth y retiros protegidos; las tres rutas redirigen al gate Auth sin desbordes.

## Revisión confirmada de ciclos

- [x] Confirmar Nodo Diario: 1%–1.5% diario, duración indefinida, mínimo $10 USDT.
- [x] Confirmar Nodo 7 Días: 2%–3% diario, 7 días más devolución del capital, mínimo $10 USDT.
- [x] Confirmar Nodo 14 Días: 3%–4% diario, 14 días más devolución del capital, mínimo $10 USDT.
- [x] Confirmar Nodo 21 Días: 4%–5% diario, 21 días más devolución del capital, mínimo $10 USDT.
- [x] Verificar que no queden referencias visibles a ciclos anteriores; auditoría sin coincidencias antiguas.

## Auditoría actual: comisiones directo y binario

- [x] Localizar cálculos reales de comisión directa y binaria.
- [x] Distinguir datos visuales, estado local y persistencia remota.
- [x] Documentar fórmulas, fuentes de datos y limitaciones actuales.

## Nueva etapa: bonos directo y binario en Supabase

- [x] Fijar configuración inicial: directo 10% y binario 10% sobre contratos confirmados/pagados.
- [x] Fijar patrocinador directo y dejar la asignación izquierda/derecha configurable para la primera versión.
- [x] Fijar volumen válido como contratos confirmados, emparejamiento por mínimo de ambas piernas, arrastre del excedente y sin límite adicional inicial.
- [ ] Diseñar tablas de red, volumen y ledger de comisiones con claves idempotentes.
- [ ] Implementar funciones server-side y políticas RLS sin acreditar desde el cliente.
- [ ] Añadir pruebas para directo, binario, duplicados, reversos y límites.
- [ ] Integrar bonos calculados en dashboard e historial después de validar reglas.

## Aplicación y verificación de migración de comisiones

- [x] Aplicar en Supabase la migración PostgreSQL de network_nodes, commission_events, network_volume y commission_ledger.
- [x] Verificar RLS, índices y función server-side; constraints y service_role quedaron definidos en la migración, pendientes de consulta independiente.
- [x] Documentar que la migración quedó aplicada; el SQL Editor sigue requiriendo verificación manual por el error de selección vacía.
