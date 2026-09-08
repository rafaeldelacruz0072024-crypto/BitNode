-- No rates are seeded: existing payouts remain unchanged until an admin saves.
create schema if not exists bitnode_private;
revoke all on schema bitnode_private from public, anon, authenticated;

create function bitnode_private.valid_monthly_rates(p_rates jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(p_rates) <> 'object' then false else
    (select count(*) = 4 and bool_and(
      key = any(array['daily','seven','fourteen','twentyOne'])
      and case when jsonb_typeof(value) = 'number' then
        (value::text)::numeric between 0 and 1000
        and round((value::text)::numeric, 2) = (value::text)::numeric
      else false end
    ) from jsonb_each(p_rates)) end;
$$;

create table public.monthly_node_roi (
  month date primary key check (extract(day from month) = 1 and extract(year from month) between 2000 and 2099),
  rates jsonb not null check (bitnode_private.valid_monthly_rates(rates)),
  version integer not null check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
create table public.monthly_node_roi_history (
  month date not null,
  version integer not null,
  rates jsonb not null,
  updated_at timestamptz not null,
  updated_by uuid not null,
  primary key (month, version)
);
alter table public.monthly_node_roi enable row level security;
alter table public.monthly_node_roi_history enable row level security;
revoke all on public.monthly_node_roi, public.monthly_node_roi_history from public, anon, authenticated;
grant select on public.monthly_node_roi, public.monthly_node_roi_history to service_role;

create function public.save_monthly_node_roi(p_month date, p_rates jsonb, p_expected_version integer, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_row public.monthly_node_roi%rowtype;
begin
  if not exists (select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = p_actor and p.role = 'admin' and lower(u.email) = 'gentecash@gmail.com') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_month is null or p_rates is null or p_expected_version is null or p_expected_version < 0
     or extract(day from p_month) <> 1 or extract(year from p_month) not between 2000 and 2099
     or not bitnode_private.valid_monthly_rates(p_rates) then
    raise exception 'Invalid monthly configuration' using errcode = '22023';
  end if;
  -- Serializes first saves too; concurrent editors cannot silently overwrite.
  perform pg_advisory_xact_lock(93621, (p_month - date '2000-01-01')::integer);
  select * into v_row from public.monthly_node_roi where month = p_month for update;
  if coalesce(v_row.version, 0) <> p_expected_version then
    raise exception 'Monthly configuration changed' using errcode = '40001';
  end if;
  insert into public.monthly_node_roi(month, rates, version, updated_by)
  values(p_month, p_rates, p_expected_version + 1, p_actor)
  on conflict(month) do update set rates = excluded.rates, version = excluded.version,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  insert into public.monthly_node_roi_history select v_row.month, v_row.version, v_row.rates, v_row.updated_at, v_row.updated_by;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.save_monthly_node_roi(date,jsonb,integer,uuid) from public, anon, authenticated;
grant execute on function public.save_monthly_node_roi(date,jsonb,integer,uuid) to service_role;

create function bitnode_private.monthly_daily_rate(p_duration integer, p_day date)
returns numeric language sql stable set search_path = pg_catalog as $$
  select (r.rates ->> case when p_duration is null then 'daily'
    when p_duration = 7 then 'seven' when p_duration = 14 then 'fourteen'
    when p_duration = 21 then 'twentyOne' end)::numeric / 100 / (
      select count(*) from generate_series(date_trunc('month', p_day::timestamp),
        date_trunc('month', p_day::timestamp) + interval '1 month - 1 day', interval '1 day') d
      where extract(isodow from d) between 1 and 5
    )
  from public.monthly_node_roi r where r.month = date_trunc('month', p_day::timestamp)::date;
$$;
revoke all on function bitnode_private.valid_monthly_rates(jsonb), bitnode_private.monthly_daily_rate(integer,date) from public, anon, authenticated;

-- Patch only the rate expression, preserving the installed cycle safeguards.
-- Abort rather than replace an unknown production function definition.
do $$
declare
  v_definition text;
  v_old text := 'v_rate := round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6);';
  v_new text := 'v_rate := round(coalesce(bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date), (v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric), 6); if v_rate <= 0 then continue; end if;';
begin
  select pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure) into v_definition;
  if position(v_old in v_definition) = 0 then
    raise exception 'Unknown daily task engine. Review installed rate calculation before applying monthly ROI.';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;
