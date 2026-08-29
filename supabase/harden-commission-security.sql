-- BitNode: endurecimiento de seguridad para el motor de comisiones.
-- Ejecutar después de commissions-ledger.sql.
-- No elimina tablas ni datos.
-- El guard interno de auth.role() ya está incluido en commissions-ledger.sql.

-- Revoca cualquier permiso heredado o concedido accidentalmente.
revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from public;
revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from anon;
revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from authenticated;

-- Solo el rol interno de Supabase puede ejecutar el cálculo.
grant execute on function public.process_contract_commissions(text, text, uuid, numeric, text) to service_role;

-- El backend debe usar un cliente Supabase inicializado con SUPABASE_SERVICE_ROLE_KEY.
-- Nunca expongas esa clave en el navegador ni en variables VITE_*.

-- Auditoría de permisos. Resultado esperado:
-- anon_can_execute = false
-- authenticated_can_execute = false
-- service_role_can_execute = true
select
  has_function_privilege('anon', 'public.process_contract_commissions(text,text,uuid,numeric,text)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.process_contract_commissions(text,text,uuid,numeric,text)', 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', 'public.process_contract_commissions(text,text,uuid,numeric,text)', 'EXECUTE') as service_role_can_execute;

-- Auditoría adicional de funciones SECURITY DEFINER en public.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'process_contract_commissions';
