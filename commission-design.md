# Diseño técnico inicial de bonos

## Alcance

Esta primera versión calcula los bonos exclusivamente en el servidor y conserva un ledger inmutable de eventos. El cliente no podrá insertar ni modificar saldos de bonos directamente. Las tasas se almacenan como configuración para que puedan cambiarse mediante una migración o una operación administrativa controlada.

## Reglas iniciales

| Concepto | Regla inicial |
|---|---|
| Bono directo | 10% del importe de un contrato confirmado y pagado |
| Beneficiario directo | El patrocinador directo almacenado en la red del usuario que activó el contrato |
| Bono binario | 8% del volumen emparejado entre las piernas izquierda y derecha |
| Volumen elegible | Contratos confirmados, no cancelados ni reembolsados |
| Emparejamiento | `matched = min(left_volume, right_volume)` |
| Arrastre | Se conserva el excedente de cada pierna después de descontar el volumen emparejado |
| Asignación de pierna | Se guarda explícitamente como `left` o `right`; no se infiere durante el cálculo |
| Límite adicional | Ninguno en esta versión; el modelo deja un campo para añadirlo posteriormente |
| Reversos | Una cancelación o reembolso crea una entrada negativa compensatoria, sin borrar el ledger original |

## Modelo de patrocinio y red

Cada usuario puede tener como máximo un registro en `network_nodes`. `sponsor_id` identifica al patrocinador directo. `parent_id` identifica el nodo inmediatamente superior dentro del árbol binario. `leg` es obligatorio para nodos no raíz y solo admite `left` o `right`. La combinación `(parent_id, leg)` es única para impedir dos hijos en la misma pierna.

La asignación de una pierna se realiza al registrar o mover un nodo mediante una operación server-side. No se permite que el navegador decida el `parent_id` de otra persona ni que modifique una relación existente sin una operación administrativa autorizada.

## Volumen y ledger

`network_volume` mantiene el volumen acumulado confirmado por usuario y pierna. El cálculo de un evento de contrato actualiza el volumen y genera entradas en `commission_ledger`. La clave única `(source_event_id, commission_type, beneficiary_id)` hace idempotente el cálculo: repetir el mismo evento no puede duplicar un bono.

Para el binario, el cálculo recorre los ancestros desde el usuario que activó el contrato. En cada ancestro, suma el importe a la pierna correspondiente, calcula el nuevo `matched_volume` contra la otra pierna y registra 10% del nuevo volumen emparejado. El remanente se conserva en `network_volume`.

## Estados y seguridad

Los contratos deben llegar al motor con estado `confirmed`. Los estados `pending`, `failed`, `cancelled` o `refunded` no generan bonos positivos. Si un contrato confirmado se revierte, el motor registra un evento de reverso vinculado a la comisión original y nunca elimina la evidencia histórica.

Las políticas RLS permiten al usuario autenticado consultar únicamente sus propios nodos, volumen y ledger. Las inserciones, actualizaciones y reversos son operaciones server-side con service role y validación del usuario autenticado; el service role nunca se expone al navegador.

## Pendientes deliberados

La primera versión no añade límites diarios, rangos ni liquidación periódica. Antes de usarla en producción financiera deben confirmarse las reglas regulatorias, los límites de pago, la política de reembolsos y la revisión contable del sistema.
