begin;

-- Future daily-task accruals for legacy plans use their catalog minimum.
create or replace function bitnode_private.plan_daily_rate(p_plan_id text,p_duration integer,p_day date)
returns numeric language plpgsql volatile set search_path='' as $$
declare v_plan public.plans%rowtype;
begin
  select * into strict v_plan from public.plans where id=p_plan_id;
  if v_plan.node_version=1 then
    return v_plan.rate_min;
  end if;
  return v_plan.rate_min + random()*(v_plan.rate_max-v_plan.rate_min);
end;
$$;
revoke all on function bitnode_private.plan_daily_rate(text,integer,date) from public,anon,authenticated;

commit;
