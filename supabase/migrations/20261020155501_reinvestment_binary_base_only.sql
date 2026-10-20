begin;
-- Forward-only rule installation: no historical events or balances are replayed.
do $patch$
declare
  definition text := pg_get_functiondef('public.process_contract_commissions(text,text,uuid,numeric,text)'::regprocedure);
  old_start integer;
  old_end integer;
  anchor constant text := 'perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));';
  direct_anchor constant text := 'if v_sponsor_id is not null';
  guard constant text := $guard$
  -- reinvestment_binary_base_only_v2
  v_reinvestment := left(upper(trim(p_contract_id)), 9) = 'REINVEST-'
    or exists(select 1 from public.finite_node_capital_choices where new_contract_id=trim(p_contract_id) and action='reinvest')
    or exists(select 1 from public.transactions where id=trim(p_contract_id) and provider_status like 'finite_capital_reinvested%');
  if v_reinvestment then
    select amount into v_reinvestment_base from public.finite_node_capital_choices
      where new_contract_id=trim(p_contract_id) and action='reinvest' and status='reinvested' and user_id=p_user_id;
    if not found then
      -- Transaction is inserted before the choice row; its debit excludes the bonus.
      select abs(amount) into v_reinvestment_base from public.transactions
        where id=trim(p_contract_id) and user_id=p_user_id and type='contract'
          and status='completed' and amount<0 and provider_status like 'finite_capital_reinvested%';
    end if;
    if v_reinvestment_base is null or v_reinvestment_base<=0 then
      raise exception 'Verified reinvestment base required';
    end if;
    p_amount := v_reinvestment_base;
    -- Canonical identity prevents double volume from alternate API/trigger event IDs.
    p_contract_id := trim(p_contract_id);
    p_source_event_id := 'REINVEST-BINARY-' || p_contract_id;
  end if;
  $guard$;
begin
  if position('reinvestment_binary_base_only_v2' in definition)>0 then return; end if;
  old_start := position('-- reinvestment_no_commissions_v1' in definition);
  old_end := position(anchor in definition);
  if old_start=0 or old_end<=old_start
     or position('v_delta numeric;' in definition)=0
     or position(direct_anchor in definition)=0 then
    raise exception 'Unknown commission engine; review before enabling reinvestment binary volume';
  end if;
  definition := substring(definition from 1 for old_start-1) || guard || substring(definition from old_end);
  definition := replace(definition,'v_delta numeric;',E'v_delta numeric;\n  v_reinvestment boolean := false;\n  v_reinvestment_base numeric;');
  definition := replace(definition,direct_anchor,'if not v_reinvestment and v_sponsor_id is not null');
  execute definition;
end;
$patch$;

-- Atomic integration: the capital choice and its binary event commit together.
-- Existing transaction-trigger dispatch is safe because the engine canonicalizes IDs.
create or replace function bitnode_private.credit_reinvestment_binary_base()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.action='reinvest' and new.status='reinvested' then
    perform public.process_contract_commissions('REINVEST-BINARY-' || new.new_contract_id,
      new.new_contract_id,new.user_id,new.amount,'contract_confirmed');
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.credit_reinvestment_binary_base() from public,anon,authenticated;
drop trigger if exists credit_reinvestment_binary_base on public.finite_node_capital_choices;
create trigger credit_reinvestment_binary_base after insert on public.finite_node_capital_choices
for each row execute function bitnode_private.credit_reinvestment_binary_base();
revoke all on function public.process_contract_commissions(text,text,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.process_contract_commissions(text,text,uuid,numeric,text) to service_role;
notify pgrst,'reload schema';
commit;
