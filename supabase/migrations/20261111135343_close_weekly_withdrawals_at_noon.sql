do $hours$
declare
  original text;
  revised text;
begin
  original := pg_get_functiondef('public.get_withdrawal_availability(uuid,timestamptz)'::regprocedure);
  if regexp_count(original, 'interval ''5 hours''') <> 3 then
    raise exception 'Unexpected withdrawal schedule';
  end if;
  execute replace(original, 'interval ''5 hours''', 'interval ''3 hours''');

  original := pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure);
  revised := replace(original, '9:00 a 14:00', '9:00 a 12:00');
  if revised = original then
    raise exception 'Unexpected withdrawal validation message';
  end if;
  execute revised;
end $hours$;
notify pgrst, 'reload schema';
