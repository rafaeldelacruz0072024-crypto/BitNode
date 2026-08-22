# Matriz de amenazas de seguridad

| Amenaza | Endpoint o componente | Impacto | Control verificado | Límite de prueba |
|---|---|---|---|---|
| Acceso sin sesión | `/api/deposits/request`, `/api/withdrawals/request`, `/api/contracts/activate`, `/api/commissions/summary` | Lectura o escritura financiera no autorizada | Validación Bearer + `auth.getUser`; pruebas 401 y funciones RPC no ejecutables por cliente | Sin credenciales reales ni escrituras |
| Manipulación de monto | Depósito, retiro y activación | Acreditación o débito indebido | Validadores de mínimo, máximo, balance y parámetros server-side | Solo inputs sintéticos |
| Doble acreditación | Eventos y ledger de comisiones | Pago duplicado | Claves únicas, evento fuente y respuestas `duplicate` | Dobles inyectados; no Supabase real bajo carga |
| Carrera de activaciones | RPC de activación | Balance negativo o doble contrato | Operación atómica y bloqueo server-side | Concurrencia simulada contra mocks |
| Abuso de solicitudes | Rutas `/api` y financieras | Degradación o fuerza bruta | `express-rate-limit`: API 300/15 min; financieras 30/min | 120 solicitudes locales, 20 concurrentes |
| Payload excesivo | Parser Express | Consumo de memoria o DoS | JSON 1 MB; URL-encoded 64 KB | Sin payload destructivo; solo configuración y validadores |
| Exposición de stack/secrets | Servidor y cliente | Filtración de credenciales | Service role solo en servidor; cliente usa sesión; errores normalizados | Revisión estática local |
| Headers inseguros | Respuestas HTTP | Clickjacking y MIME sniffing | Helmet, `x-powered-by` desactivado, `trust proxy` configurado | Verificación con `curl` local |
| RLS insuficiente | Tablas Supabase | Lectura cruzada entre usuarios | RLS y grants verificados en SQL Editor | No se ejecutaron consultas destructivas |

## Límites

La matriz no cubre payout real, NOWPayments, pruebas de carga contra Supabase remoto, multi-instancia, Redis, WAF, rotación de secretos ni revisión legal. Es una auditoría local y controlada; cualquier prueba de staging debe usar datos sintéticos y autorización explícita.
