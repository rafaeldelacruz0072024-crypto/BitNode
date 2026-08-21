# Auditoría local de seguridad y flujos financieros

## Alcance

Esta revisión cubre los flujos de depósitos manuales, retiros, activación de contratos y comisiones directo/binario en el entorno local de BitNode. NOWPayments queda deliberadamente fuera de esta etapa y se mantiene pospuesto para el cierre del proyecto.

## Controles verificados

| Flujo | Control actual | Estado |
|---|---|---|
| Depósito manual | Endpoint autenticado; crea `pending`; no acredita balance | Implementado |
| Retiro | Endpoint autenticado; valida red, wallet, mínimo, límite diario y comisión | Implementado como pre-solicitud |
| Activación de contrato | RPC server-side atómico; valida usuario, balance y monto; dispara comisiones | Implementado |
| Bono directo | 10% sobre evento confirmado; ledger idempotente | Implementado en Supabase |
| Bono binario | 10% sobre volumen emparejado; arrastre en `network_volume` | Implementado en Supabase |
| Funciones financieras | `EXECUTE` revocado para `anon` y `authenticated` | Verificado |
| Historial | Combina movimientos propios con entradas del ledger remoto | Implementado |

## Hallazgos corregidos

El cliente podía registrar anteriormente un depósito como `completed` y aumentar el balance local antes de una confirmación externa. El flujo se cambió para crear una solicitud `pending` mediante `/api/deposits/request`; el balance disponible no se modifica. La validación de montos está cubierta por pruebas unitarias.

La activación de contratos dejó de depender de una fila `completed` creada directamente por el navegador. El endpoint `/api/contracts/activate` invoca `activate_contract_and_commissions` con `service_role`; la función bloquea la fila, comprueba el balance agregado de operaciones completadas, inserta el contrato y procesa el evento de comisión en la misma operación de base de datos.

## Límites actuales

La auditoría no sustituye una revisión de producción. Todavía no se han probado payouts reales, conciliación bancaria o crypto, recuperación ante fallos del proveedor, límites de velocidad, pruebas de carga, revisión de secretos, monitoreo, rotación de credenciales ni un flujo administrativo de aprobación de retiros. NOWPayments continúa pendiente por el error sandbox 403 de creación de invoice.

Los porcentajes de ciclos y bonos son reglas de producto configuradas en el sistema; no constituyen una garantía financiera ni una recomendación de inversión. Antes de operar con usuarios reales se necesita revisión legal, contable y de cumplimiento aplicable a la jurisdicción objetivo.

## Resultado técnico

La suite local termina con 18 pruebas pasando y el build de producción compila correctamente. El sistema queda en una fase de prueba controlada: los depósitos manuales no acreditan fondos automáticamente, los retiros siguen siendo pre-solicitudes y las comisiones solo se procesan mediante funciones protegidas del backend.
