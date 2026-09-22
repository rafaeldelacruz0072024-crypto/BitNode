-- Read-only production verification for the active-node commission rule.

select
  to_regprocedure('bitnode_private.has_active_node(uuid)') is not null
    as active_node_helper_exists,
  to_regprocedure('bitnode_private.require_active_node_for_commission()') is not null
    as ledger_guard_exists;

select
  trigger_name,
  action_timing,
  event_manipulation
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'commission_ledger'
  and trigger_name = 'a_require_active_node_for_commission';

with definition as (
  select pg_get_functiondef(
    'public.process_contract_commissions(text,text,uuid,numeric,text)'::regprocedure
  ) as source
)
select
  position('bitnode_private.has_active_node(v_sponsor_id)' in source) > 0
    as direct_requires_active_node,
  position('bitnode_private.has_active_node(v_current)' in source) > 0
    as binary_requires_active_node,
  position('set matched_volume = v_new_matched' in source) > 0
    as inactive_match_cannot_be_paid_later
from definition;

select
  has_function_privilege(
    'anon',
    'public.process_contract_commissions(text,text,uuid,numeric,text)',
    'EXECUTE'
  ) as anon_can_process,
  has_function_privilege(
    'authenticated',
    'public.process_contract_commissions(text,text,uuid,numeric,text)',
    'EXECUTE'
  ) as authenticated_can_process,
  has_function_privilege(
    'service_role',
    'public.process_contract_commissions(text,text,uuid,numeric,text)',
    'EXECUTE'
  ) as service_role_can_process;
