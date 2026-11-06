# BitNode Wallet local

Aplicación React separada de la plataforma, inspirada en la estructura de estadísticas de suministro y terminal conectado de https://www.xfee.fun/. Conserva las reglas propias de BitNode BEP-20: emisión inicial de 11 millones y quema voluntaria. No copia las reglas de minería, staking o comisiones de XFEE.

## Ejecutar

`npm ci --ignore-scripts`, `npm run dev`. Abrir http://127.0.0.1:5188/ en Chrome con MetaMask u otro proveedor EIP-1193 compatible. `npm test` verifica cálculos y direcciones; `npm run build` genera la distribución.

## Disponible

- Conexión solicitada por el usuario; consulta de dirección y BNB en BSC (56) o BSC Testnet (97).
- Rechazo de otras redes; al cambiar cuenta o red se limpian datos para evitar saldos obsoletos.
- Dirección de recepción, copiar y QR de dirección sin monto ni token incorporados.
- Configuración de contrato por sesión y lectura de nombre, símbolo, decimales, emisión inicial, totalSupply y balanceOf.
- Cálculo de tokens quemados = emisión inicial menos suministro total. No se denomina circulante al totalSupply.
- Sin servidor custodio, creación/importación de claves ni almacenamiento de seeds. Las claves quedan en la wallet externa. Desconectar limpia la interfaz; revocar permisos se realiza en la wallet externa.

## Pendiente

El contrato no está desplegado. No hay precio, canje, compras, envíos, firma de quemas ni reparto de recompensas. El historial se presenta explícitamente como pendiente de indexación, no como prueba de ausencia de transacciones. La dirección configurada debe verificarse oficialmente: cualquier contrato puede imitar metadatos.

La app no convierte ni modifica balances USDT de BitNode. La futura integración requiere fijar chain ID y contrato oficiales en configuración revisada, reutilizar estos componentes y conectar un indexador con paginación/reorganizaciones y reconciliación. La wallet externa sigue siendo quien firma, con confirmación expresa del usuario.

Validación actual: build, pruebas unitarias y navegación/validación visual local. Sin prueba con wallet real ni transacciones on-chain.
