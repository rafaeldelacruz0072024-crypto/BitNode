create or replace function bitnode_private.plan_daily_rate(p_plan_id text,p_duration integer,p_day date)
returns numeric language plpgsql stable set search_path='' as $$
declare v_rate numeric;
begin
  select rate_min into strict v_rate from public.plans where id=p_plan_id;
  return v_rate;
end;
$$;
revoke all on function bitnode_private.plan_daily_rate(text,integer,date) from public,anon,authenticated;
