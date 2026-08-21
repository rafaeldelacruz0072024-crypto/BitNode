# Notas de migración Supabase

El editor SQL del proyecto `kmiuwbnduedaqpaytbhz` está accesible en el navegador autenticado mediante `https://supabase.com/dashboard/project/kmiuwbnduedaqpaytbhz/sql/new`.

La herramienta de ejecución SQL del proyecto Manus se conecta a TiDB/MySQL y rechazó la migración PostgreSQL con `ERROR 1064`; por tanto, no se debe usar para crear estas tablas en Supabase. La migración debe ejecutarse en el editor SQL de Supabase.

El editor muestra el botón Run y un área de código vacía; todavía no se ha ejecutado la migración de comisiones.

La ejecución del bloque completo en SQL Editor devolvió `Error: query: Too small: expected string to have >=1 characters`. El editor sí recibió el contenido, pero el bloque largo/multisentencia no se ejecutó. Se continuará con bloques más pequeños, primero tablas e índices, después RLS y función.

El bloque corto también devuelve el mismo error al ejecutar. El texto visible cambia, pero el editor parece conservar un estado interno anterior o estar ejecutando una selección vacía. Se probará limpiar el editor con Control+A y escribir una sentencia mínima de verificación antes de continuar.

El área visible del SQL Editor es un `div[role=code]`, no un campo editable estándar; Control+A selecciona toda la página y la automatización no logra sincronizar una selección ejecutable. Después de varios intentos, Supabase sigue devolviendo `Too small: expected string to have >=1 characters`. No se han creado tablas confirmadas todavía.

Al iniciar esta etapa, My Browser estaba en otro proyecto Supabase (`NOVA Digital`, ref. `highecwkafvuhptqodue`). Se navegó al proyecto correcto de BitNode (`kmiuwbnduedaqpaytbhz`), pero Supabase muestra la pantalla de inicio de sesión. No se ejecutó ninguna migración en el proyecto equivocado.

La sesión permitió ver el SQL Editor del proyecto correcto y la consulta histórica mostraba `Success. No rows returned`, lo que sugiere que el bloque de migración pudo haberse ejecutado. Al abrir `/sql/new` para una verificación separada, Supabase volvió a mostrar la pantalla de inicio de sesión. No se pudo completar aún una consulta independiente de verificación.

La consulta de verificación fue escrita en el SQL Editor correcto, pero al pulsar Run volvió a aparecer `Too small: expected string to have >=1 characters`; no se obtuvo resultado. Se abrió el Table Editor del mismo proyecto como vía alternativa, pero la primera carga no entregó elementos visibles.

Verificación visual en el proyecto correcto `bitnode` (`kmiuwbnduedaqpaytbhz`):

- Table Editor muestra `commission_events`, `commission_ledger`, `network_nodes`, `network_volume` y `transactions`.
- Database > Functions muestra `process_contract_commissions(p_source_event_id text, p_contract_id text, p_user_id uuid, p_amount numeric, p_event_type text default 'contract_confirmed')`, retorno `jsonb`, seguridad `Definer`.
- Database > Policies muestra RLS activo para las cuatro tablas nuevas.
- Database > Indexes muestra índices de eventos, beneficiarios, red, volumen y la restricción única del ledger.

El SQL Editor todavía produce el error de selección vacía al ejecutar consultas automatizadas, pero la verificación por Table Editor, Functions, Policies e Indexes confirma estructuralmente la migración.

La navegación al detalle de `network_nodes` queda en estado de carga y no expone columnas/constraints en el contenido extraído. Por ello, las constraints completas y el GRANT EXECUTE a service_role siguen confirmados por revisión del SQL aplicado, pero no por una consulta independiente ejecutada.
