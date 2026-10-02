-- Read-only production verification after applying the SARA IA migration.
select extname, extversion from pg_extension where extname = 'pg_cron';

select jobname, schedule, active, command
from cron.job
where jobname = 'bitnode-sara-ia-weekday-tasks';

select n.nspname as schema_name, p.proname, p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as function_owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in
  (('public', 'complete_sara_ia_payment'), ('bitnode_private', 'run_sara_ia_daily'));

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('sara_ia_subscriptions', 'sara_ia_payments', 'sara_ia_runs')
order by c.relname;

select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema in ('public', 'bitnode_private')
  and routine_name in ('complete_sara_ia_payment', 'run_sara_ia_daily')
order by routine_schema, routine_name, grantee;
