-- Verificación estructural de la migración de comisiones.
-- Solo lectura: no inserta, actualiza ni elimina datos.

-- 1) Constraints, claves foráneas y restricciones únicas/check.
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type
from information_schema.table_constraints tc
where tc.constraint_schema = 'public'
  and tc.table_name in ('network_nodes', 'commission_events', 'network_volume', 'commission_ledger')
order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- 2) RLS y políticas existentes.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relname in ('network_nodes', 'commission_events', 'network_volume', 'commission_ledger')
group by c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relname;

-- 3) Firma y seguridad de la función.
select
  routine_schema,
  routine_name,
  external_language,
  security_type,
  data_type as return_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'process_contract_commissions';

-- 4) Permisos de ejecución de la función.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name = 'process_contract_commissions'
order by grantee, privilege_type;

-- 5) Índices principales.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('network_nodes', 'commission_events', 'network_volume', 'commission_ledger')
order by tablename, indexname;
