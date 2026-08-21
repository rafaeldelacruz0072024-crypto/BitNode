-- Verificación de la función atómica de activación.
-- Solo lectura; no modifica datos ni saldos.

select
  routine_schema,
  routine_name,
  security_type,
  data_type as return_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('activate_contract_and_commissions', 'process_contract_commissions')
order by routine_name;

select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in ('activate_contract_and_commissions', 'process_contract_commissions')
order by routine_name, grantee, privilege_type;
