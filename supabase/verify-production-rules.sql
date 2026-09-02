-- BitNode: auditoría de solo lectura para ejecutar después de aplicar la migración.

-- 1) El motor de tareas nuevo debe ser el único expuesto al usuario autenticado.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('complete_daily_task', 'complete_daily_tasks', 'get_daily_task_cycle')
order by p.proname;

-- 2) No puede existir más de un rendimiento por nodo y fecha.
select contract_id, reward_date, count(*) as rows_per_day
from public.contract_cycle_rewards
group by contract_id, reward_date
having count(*) > 1;

-- 3) Contratos finitos: la devolución de capital solo debe existir una vez
-- y únicamente para contratos completados.
select
  c.id as contract_id,
  c.status,
  c.principal_returned_at,
  count(t.id) filter (where t.label like 'Capital devuelto - %' and t.status = 'completed') as principal_returns
from public.contracts c
left join public.transactions t on t.id = 'PRINCIPAL-' || c.id
join public.plans p on p.id = c.plan_id
where p.duration_days is not null
group by c.id, c.status, c.principal_returned_at
order by c.id;

-- 4) Comisión: directa 10%, binaria 8%, sin acceso directo del navegador.
select
  has_function_privilege('anon', 'public.process_contract_commissions(text,text,uuid,numeric,text)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.process_contract_commissions(text,text,uuid,numeric,text)', 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', 'public.process_contract_commissions(text,text,uuid,numeric,text)', 'EXECUTE') as service_role_can_execute;

select commission_type, rate, count(*) as entries
from public.commission_ledger
where status = 'credited'
group by commission_type, rate
order by commission_type, rate;
