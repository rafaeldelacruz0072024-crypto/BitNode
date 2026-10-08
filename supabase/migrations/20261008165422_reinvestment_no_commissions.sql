begin;

-- Preserve the deployed engine and its existing eligibility/idempotency rules.
-- Abort on an unknown definition rather than overwrite an unreviewed engine.
do $migration$
declare
  definition text := pg_get_functiondef('public.process_contract_commissions(text,text,uuid,numeric,text)'::regprocedure);
  anchor constant text := 'perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));';
  guard constant text := $guard$
  -- reinvestment_no_commissions_v1: reinvestment is not a new sale.
  if left(upper(trim(p_contract_id)), 9) = 'REINVEST-'
     or exists (
       select 1 from public.finite_node_capital_choices
       where new_contract_id = trim(p_contract_id) and action = 'reinvest'
     )
     or exists (
       select 1 from public.transactions
       where id = trim(p_contract_id)
         and provider_status like 'finite_capital_reinvested%'
     ) then
    return jsonb_build_object('status', 'processed', 'source_event_id', p_source_event_id,
      'direct', 0, 'binary', 0, 'reason', 'reinvestment_no_commissions');
  end if;
  $guard$;
begin
  if position('reinvestment_no_commissions_v1' in definition) = 0 then
    if position(anchor in definition) = 0
       or (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'Unknown commission engine; review definition before installing reinvestment exclusion.';
    end if;
    execute replace(definition, anchor, guard || E'\n  ' || anchor);
  end if;
end;
$migration$;

revoke all on function public.process_contract_commissions(text,text,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.process_contract_commissions(text,text,uuid,numeric,text) to service_role;
notify pgrst, 'reload schema';
commit;
