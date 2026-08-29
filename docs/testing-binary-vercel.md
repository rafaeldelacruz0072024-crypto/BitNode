# Pruebas, puntos binarios y variables de Supabase

## 1. Configuración de Vitest

El proyecto ya contiene Vitest en `devDependencies`, el script `pnpm test` y `vitest.config.ts` con entorno Node e inclusión de `server/**/*.test.ts`.

Desde la raíz del repositorio:

```bash
pnpm install
pnpm test -- --run
pnpm test -- --run server/commissions.endpoint.test.ts
pnpm check
```

El error `vitest: not found` significa que todavía no se instaló `node_modules`; se resuelve con `pnpm install`.

Las pruebas unitarias no deben llamar a Supabase real. Deben simular `auth.getUser`, `.from(...).maybeSingle()` y `.rpc(...)`. La prueba de integración contra una base de staging sí debe verificar el cálculo real de PostgreSQL.

La ruta debe registrarse una sola vez en `server/app.ts`:

```ts
import { registerSecureCommissionRoutes } from "./secureCommissionEndpoint.js";

// dentro de createApp(), después de crear app y antes de devolverla:
registerSecureCommissionRoutes(app);
```

## 2. Casos mínimos del endpoint

El endpoint `POST /api/commissions/process` solo debe aceptar `contractId`. Debe obtener el usuario desde `Authorization: Bearer ...`, buscar el contrato filtrando por `id` y `user_id`, rechazar contratos inexistentes o no activos, obtener el monto desde la base de datos e invocar la RPC con el cliente de servidor.

Casos que deben cubrirse:

| Caso | Resultado esperado |
|---|---|
| Sin Authorization | HTTP 401 |
| Token inválido | HTTP 401 |
| Sin `contractId` | HTTP 400 |
| Contrato de otro usuario | HTTP 400; nunca se invoca la RPC |
| Contrato no activo | HTTP 400; nunca se invoca la RPC |
| Contrato activo | La RPC recibe `user_id` y `amount` obtenidos del servidor |
| Mismo evento repetido | Respuesta `duplicate`; no se duplica el ledger |
| Error RPC | HTTP 400 o 500 sin exponer detalles internos |

El archivo `server/commissions.endpoint.test.ts` contiene las pruebas unitarias de la capa de comisiones. Para probar el handler HTTP completo se puede añadir `supertest` como dependencia de desarrollo y montar `createApp()` en memoria.

## 3. Cálculo automático de puntos binarios

En este modelo, los puntos binarios se representan como volumen elegible: por defecto, **1 USDT confirmado = 1 punto binario**. Cada contrato confirmado aporta sus puntos una sola vez a la pierna del usuario y se propaga hacia sus ancestros.

Para cada ancestro:

```text
puntos_izquierda = volumen acumulado de la pierna izquierda
puntos_derecha   = volumen acumulado de la pierna derecha
puntos_emparejados = mínimo(puntos_izquierda, puntos_derecha)
nuevos_puntos = máximo(puntos_emparejados - puntos_ya_emparejados, 0)
bono_binario = nuevos_puntos × 10 %
```

Ejemplo: si la izquierda tiene 300 puntos y la derecha 200, hay 200 puntos emparejados. El pago es `200 × 0.10 = 20`. Una nueva activación de 50 en la izquierda deja 250/200 y genera otros 0 puntos; una nueva activación de 50 en la derecha deja 250/250 y genera 50 puntos nuevos, pagando 5.

La función `process_contract_commissions` ya implementa esta fórmula en `network_volume` y `commission_ledger`. La colocación debe ejecutarse antes mediante `place_network_node`, para que la cadena `parent_id` y la pierna estén disponibles.

Reglas que deben mantenerse en producción:

```text
- Solo cuentan contratos confirmados y activos.
- El mismo source_event_id no puede procesarse dos veces.
- Los puntos emparejados no se vuelven a pagar.
- No se deben contar movimientos pendientes, cancelados o reversados.
- El árbol debe tener una profundidad máxima definida.
- Las funciones internas deben ejecutarse solo con service_role.
```

## 4. Variables de entorno locales

Crear `.env.local` solo para desarrollo y no subirlo al repositorio:

```env
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICABLE
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
```

`VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` pueden llegar al frontend. `SUPABASE_SERVICE_ROLE_KEY` es exclusivamente del backend; no debe comenzar con `VITE_` ni importarse en código dentro de `client/`.

## 5. Variables en Vercel

En Vercel, abre el proyecto y ve a **Settings → Environment Variables**. Añade:

| Variable | Entorno | Exposición |
|---|---|---|
| `VITE_SUPABASE_URL` | Production, Preview y Development | Frontend |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Production, Preview y Development | Frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Production y Preview; Development solo si el backend local lo necesita | Solo servidor |

También puede hacerse con Vercel CLI:

```bash
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

Repite para `preview` y `development` según corresponda. Tras modificar variables, crea un nuevo deployment; los deployments existentes no reciben automáticamente los nuevos valores.

## 6. Verificación de seguridad

Después de configurar Vercel:

```bash
vercel env ls
```

No imprimas el valor de `SUPABASE_SERVICE_ROLE_KEY` en logs. Ejecuta la auditoría SQL y confirma:

```text
anon_can_execute = false
authenticated_can_execute = false
service_role_can_execute = true
```

Prueba el endpoint usando un token de usuario normal. Debe poder acceder al endpoint público, pero nunca debe poder invocar directamente `process_contract_commissions`; la RPC debe ser llamada únicamente por el backend con el cliente creado a partir de `SUPABASE_SERVICE_ROLE_KEY`.
