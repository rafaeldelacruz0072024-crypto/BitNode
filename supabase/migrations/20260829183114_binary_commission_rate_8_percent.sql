do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.process_contract_commissions(text, text, uuid, numeric, text)'::regprocedure) into v_definition;
  if v_definition is null then raise exception 'process_contract_commissions does not exist'; end if;
  v_definition := replace(v_definition, 'round(v_delta * 0.10, 8)', 'round(v_delta * 0.08, 8)');
  v_definition := replace(v_definition, '''binary'', v_commission, 0.10', '''binary'', v_commission, 0.08');
  execute v_definition;
end;
$migration$;
