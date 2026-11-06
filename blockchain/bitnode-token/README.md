# BitNode — token BEP-20 de beneficios y recompensas

Estado: implementación local. Sin despliegue en BNB Smart Chain ni conexión a saldos de usuarios.

## Definido

- Nombre: BitNode.
- Red objetivo: BNB Smart Chain, estándar BEP-20.
- Uso: beneficios y recompensas.
- 18 decimales; transferencias, allowances y `getOwner()`.
- Emisión inicial única: **11,000,000 tokens**, fijada en el contrato.
- Quema voluntaria mediante `burn`, o `burnFrom` con autorización del titular. Reduce permanentemente el saldo y `totalSupply`. Los tokens quemados no se pueden volver a emitir.
- No hay quema automática ni porcentaje de quema en las transferencias.

## Propuesta técnica, pendiente de decisión comercial

- Símbolo provisional BTN; se proporciona al constructor, no está fijado.
- Emisión fija, creada una sola vez en la wallet de tesorería.
- No hay emisión posterior, impuestos de transferencia, confiscación ni proxy actualizable.
- La propiedad identifica al administrador del contrato, pero no permite mover fondos de terceros. Cambiar propietario no cambia la wallet que recibió la emisión inicial.
- No existe conversión automática a USDT, precio, rentabilidad ni obligación de recompra.

## Pendiente para lanzar

1. Confirmar símbolo y distribución de recompensas/reserva/equipo.
2. Indicar una dirección pública de tesorería; las firmas se realizan desde wallet, nunca con claves enviadas al chat.
3. Definir qué acción gana tokens, cuánto, presupuesto y condiciones de canje. Esto debe preceder a cualquier integración con el ledger.
4. Probar despliegue y transferencias en BSC Testnet, verificar el contrato y revisar el código antes del despliegue real.

## Desarrollo aislado

Desde este directorio: `npm ci --ignore-scripts`, `npm test`, `npm run compile`.
Las dependencias y el lockfile están separados de la aplicación. Las pruebas usan Ganache local, sin BNB real ni RPC externo.
Las pruebas verifican la emisión exacta de 11 millones, quema propia, quema autorizada y rechazo de quemas sin permiso o sin saldo. `INITIAL_SUPPLY` conserva la emisión inicial; `totalSupply` refleja el suministro restante tras quemas.
El constructor recibe `symbol`, `treasury`; la emisión no es configurable. Para convertir unidades enteras en transferencias o quemas: `parseUnits(cantidadComoTexto, 18)`; no usar números de coma flotante.

## Integración siguiente

Mantener el saldo BEP-20 separado del balance USDT. Para repartir recompensas, registrar campaña, usuario, monto entero, dirección verificada e identificador único. Reservar el presupuesto antes de firmar, guardar hash/chain ID, confirmar recibo on-chain y reconciliar antes de marcar pagado. Un reintento no puede emitir una segunda recompensa. Canjes requieren reglas y pruebas propias; no están habilitados en esta entrega.

Fuentes: https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP20.md y https://docs.openzeppelin.com/contracts/5.x/erc20-supply.
