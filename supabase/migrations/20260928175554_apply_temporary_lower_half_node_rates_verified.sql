begin;

do $do$
declare
  fn text := pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure);
  old_rate text := $old$v_rate := round(coalesce(bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date), (v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric), 6);$old$;
  new_rate text := $new$v_rate := case
        when current_date between date '2026-09-28' and date '2026-10-02'
          then round((v_contract.rate_min + random() * ((v_contract.rate_max - v_contract.rate_min) / 2))::numeric, 6)
        else round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6)
      end;$new$;
begin
  if strpos(fn, new_rate) > 0 then
    return;
  end if;

  if strpos(fn, old_rate) = 0 then
    raise exception 'Verified production v_rate statement was not found; no changes applied.';
  end if;

  if strpos(fn, 'America/Santo_Domingo') = 0
     or strpos(fn, 'not between 1 and 5') = 0 then
    raise exception 'Monday-Friday Santo Domingo safeguards were not found; no changes applied.';
  end if;

  execute replace(fn, old_rate, new_rate);
end;
$do$;

notify pgrst, 'reload schema';
commit;
