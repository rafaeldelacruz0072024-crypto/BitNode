-- Corrección de seguridad: las funciones financieras solo deben ser invocables
-- por el backend con service_role. Esta consulta no modifica saldos ni datos.

revoke execute on function public.process_contract_commissions(text, text, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.activate_contract_and_commissions(uuid, text, text, text, numeric) from public, anon, authenticated;

grant execute on function public.process_contract_commissions(text, text, uuid, numeric, text) to service_role;
grant execute on function public.activate_contract_and_commissions(uuid, text, text, text, numeric) to service_role;
