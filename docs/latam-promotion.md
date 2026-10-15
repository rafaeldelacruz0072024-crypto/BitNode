# Pre-posicionamiento LATAM 2026

## Publicación y operación

1. Aplicar `supabase/migrations/20261015211352_latam_promotions.sql` en el proyecto BitNode autorizado. No modifica saldos ni el motor de comisiones.
2. Abrir Admin → Promociones y novedades. Revisar Transacciones y Activaciones para identificar contrato y depósito del mismo comprador.
3. Vincular exclusivamente el importe de fondos nuevos realmente aplicado a ese nodo, indicar evidencia y confirmar «Activación real elegible para promoción». También se revisan las asignaciones crypto: tener un depósito no prueba por sí solo que el nodo se financiara con ese depósito, porque el balance es fungible.
4. Cada par depósito/nodo se registra una sola vez. Varios depósitos pueden financiar un nodo y un depósito varios nodos, respetando ambos topes. Una solicitud repetida no vuelve a sumar. Para corregir una validación, revocarla; conservar su historial y registrar una nueva asignación diferente si corresponde.
5. Usuarios → Promociones y novedades: progreso propio y diez lugares públicos con username, sin correos ni datos de depósitos de terceros. Actualización al entrar, manual y cada minuto.

## Reglas

- Viaje: los primeros 10 socios en completar 15,000 USDT validados reciben solo viaje Bootcamp Cartagena, sin iPhone.
- Sorteo: quienes terminen con al menos 10,000 y menos de 15,000 USDT validados participan por 3 iPhone 18 Pro, uno por ganador. A 15,000 dejan el grupo del sorteo. No se acumulan los premios. Participación provisional hasta revisión final; este cambio no realiza un sorteo ni asigna ganadores.
- Aplicar también `supabase/migrations/20261015235040_latam_trip_and_iphone_raffle.sql`; agrega los campos de elegibilidad, contador y listado administrativo privado sin modificar ventas, saldos o comisiones.
- Período fijo: `[2026-10-16 00:00, 2026-11-26 00:00)` en America/Mexico_City. Incluye completo el 25 de noviembre. Tanto depósito como inversión deben estar dentro del período; el depósito no puede ser posterior al nodo.
- Fuente: NP con ID de proveedor y estado confirmed/finished; o ADMIN con marcador admin_manual y revisión explícita de cobro real. Excluye devoluciones de capital, cashback, bonos y reinversiones identificadas por prefijo, ledger o elección de capital.
- Estado actual de contrato y ambas transacciones se comprueba al consultar. Si una reversión se registra fuera de esos estados, revocar también su validación promocional. No se ha creado un reconciliador externo de devoluciones del proveedor.
- Patrocinador directo se captura desde profiles.sponsor_id al validar, no desde el padre binario ni desde una entrada libre del administrador.
- Orden por instante de completar 15,000 **validados**; empate resuelto por UUID del patrocinador. Una validación tardía no se antepone por fecha histórica de inversión. Clasificación provisional y recalculable ante revocaciones. No existe entrega de premios automática.
- Campaña concreta configurada en código/SQL; no es todavía un editor genérico para crear campañas arbitrarias.

## Seguridad y verificación

RPC solo service_role; API verifica JWT y perfil admin antes de escribir. RLS sin permisos de escritura de cliente sobre el registro. Bloqueo transaccional para impedir sobreasignaciones concurrentes. Auditoría en la misma transacción que la validación/revocación, sin escrituras en wallets.

Prueba PostgreSQL aislada (PGlite): `node scripts/test-latam-promotions-sql.mjs <ruta-pglite>/dist/index.js`.
Aplicar y probar la migración contra el esquema real sigue siendo requisito antes de declarar el seguimiento operativo en producción.
