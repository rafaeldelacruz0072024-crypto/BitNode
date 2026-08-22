# Resultados de auditoría de seguridad y carga local

## Alcance

Las pruebas fueron no destructivas. Se utilizó el endpoint `GET /api/commissions/summary` sin token, por lo que no se consultaron datos de usuario ni se ejecutaron escrituras financieras, depósitos, retiros o comisiones. La matriz completa de amenazas, endpoints, controles y límites está en `audit/threat-matrix.md`.

## Prueba de carga

| Escenario | Solicitudes | Concurrencia | Resultado | Latencia observada |
|---|---:|---:|---|---|
| Línea base protegida | 20 | 10 | 20 respuestas `401`, 0 `429` | p50 23.69 ms; p95 80.59 ms; máximo 80.59 ms |
| Saturación controlada | 120 | 20 | 10 respuestas `401`, 110 `429`, 0 errores de red | p50 10.66 ms; p95 29.40 ms; máximo 74.74 ms |

El resultado confirma que el endpoint rechaza solicitudes no autenticadas y que el rate limit financiero de 30 solicitudes por minuto se activa antes de permitir abuso sostenido. Las mediciones son locales y no representan capacidad de producción.

La prueba automatizada de concurrencia ejecuta 12 invocaciones paralelas del mismo evento contra un doble controlado y verifica un único resultado `credited` junto con 11 respuestas `duplicate`. La prueba automatizada del rate limiter confirma dos respuestas 200 seguidas de una respuesta 429 y un encabezado `Retry-After`.

## Headers y hardening

La respuesta incluye headers de Helmet como `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy`. También publica headers `RateLimit` y `Retry-After` cuando el límite está alcanzado.

El servidor deshabilita `X-Powered-By`, configura `trust proxy` para el proxy de despliegue, limita JSON a 1 MB y formularios URL-encoded a 64 KB. El API general tiene un límite de 300 solicitudes por 15 minutos y las rutas financieras uno de 30 por minuto.

## Hallazgo corregido durante la prueba

La primera ejecución detectó `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`, causado por la ausencia de `trust proxy` mientras el proxy enviaba `X-Forwarded-For`. Se corrigió con `app.set("trust proxy", 1)`, se reinició el servidor y las mediciones posteriores no produjeron ese error.

## Riesgos residuales

El rate limiter actual usa memoria local por instancia. Para producción multi-instancia debe migrarse a un almacén compartido como Redis o un mecanismo equivalente. Tampoco se ejecutaron pruebas con tokens reales, datos reales, escrituras financieras, usuarios concurrentes autenticados, Supabase remoto bajo carga, retiros reales o NOWPayments. Esos escenarios requieren un entorno de staging aislado, datos sintéticos y autorización explícita.

## Resultado técnico

La suite local termina con 21 pruebas pasando y el build de producción compila correctamente. Incluye pruebas de 429 por rate limiting, rechazo 413 de payload excesivo y concurrencia idempotente simulada. El sistema queda en una fase de prueba controlada: los depósitos manuales no acreditan fondos automáticamente, los retiros siguen siendo pre-solicitudes y las comisiones solo se procesan mediante funciones protegidas del backend.
