begin;

alter table public.plans add column node_version smallint not null default 1
  check (node_version in (1,2));
alter table public.plans add constraint plans_v2_terms_check check (node_version=1 or (
  cadence='business_days' and principal_returned and min_amount=10 and (
    (id='v2-10d' and duration_days=10 and rate_min=.005 and rate_max=.007) or
    (id='v2-17d' and duration_days=17 and rate_min=.008 and rate_max=.011) or
    (id='v2-33d' and duration_days=33 and rate_min=.013 and rate_max=.021)
  )
));

insert into public.plans(id,name,slug,rate_min,rate_max,cadence,duration_days,min_amount,principal_returned,active,node_version)
values
 ('v2-10d','Nodo 2.0 · 10 días','nodo-v2-10-dias',.005,.007,'business_days',10,10,true,false,2),
 ('v2-17d','Nodo 2.0 · 17 días','nodo-v2-17-dias',.008,.011,'business_days',17,10,true,false,2),
 ('v2-33d','Nodo 2.0 · 33 días','nodo-v2-33-dias',.013,.021,'business_days',33,10,true,false,2);
insert into public.platform_settings(key,value)
values('nodes_v2_release','{"enabled":false}'::jsonb) on conflict(key) do nothing;

-- Keep both generations' existing terms intact. New V2 terms are immutable;
-- launch can change active without changing rates or earned entitlements.
create function bitnode_private.protect_node_generation_terms()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.node_version is distinct from new.node_version then
    raise exception 'No se puede cambiar la generación de un plan existente.';
  end if;
  if old.node_version=2 and
    (old.id,old.rate_min,old.rate_max,old.duration_days,old.cadence,old.min_amount,old.principal_returned)
      is distinct from
    (new.id,new.rate_min,new.rate_max,new.duration_days,new.cadence,new.min_amount,new.principal_returned) then
    raise exception 'Las condiciones de un Nodo 2.0 no se pueden cambiar retroactivamente.';
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.protect_node_generation_terms() from public,anon,authenticated;
create trigger protect_node_generation_terms before update on public.plans
for each row execute function bitnode_private.protect_node_generation_terms();

create function bitnode_private.add_mexico_business_days(p_start timestamptz,p_days integer)
returns timestamptz language plpgsql immutable set search_path='' as $$
declare v_local timestamp := p_start at time zone 'America/Mexico_City'; v_count integer:=0;
begin
  if p_start is null or p_days is null or p_days<1 or p_days>366 then
    raise exception 'Plazo de días hábiles inválido.';
  end if;
  while v_count<p_days loop
    v_local:=v_local+interval '1 day';
    if extract(isodow from v_local) between 1 and 5 then v_count:=v_count+1; end if;
  end loop;
  return v_local at time zone 'America/Mexico_City';
end;
$$;
revoke all on function bitnode_private.add_mexico_business_days(timestamptz,integer) from public,anon,authenticated;

create function bitnode_private.guard_nodes_v2_contract()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan public.plans%rowtype; v_old_version smallint;
begin
  select * into v_plan from public.plans where id=new.plan_id;
  if tg_op='UPDATE' then
    select node_version into v_old_version from public.plans where id=old.plan_id;
    if (v_old_version=2 or v_plan.node_version=2) and new.plan_id is distinct from old.plan_id then
      raise exception 'No se puede convertir un contrato entre generaciones o planes 2.0.';
    end if;
    return new;
  end if;
  if v_plan.node_version=2 then
    perform 1 from public.platform_settings where key='nodes_v2_release' and value->'enabled'='true'::jsonb for share;
    if not found or not v_plan.active then
      raise exception 'Los Nodos 2.0 aún no están habilitados para compra.' using errcode='P0001';
    end if;
    if new.amount< v_plan.min_amount or new.amount<>round(new.amount,2) then
      raise exception 'Monto de Nodo 2.0 inválido.' using errcode='P0001';
    end if;
    new.ends_at:=bitnode_private.add_mexico_business_days(new.starts_at,v_plan.duration_days);
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.guard_nodes_v2_contract() from public,anon,authenticated;
create trigger guard_nodes_v2_contract before insert or update of plan_id on public.contracts
for each row execute function bitnode_private.guard_nodes_v2_contract();

-- Separate rate resolution: legacy monthly policies continue unchanged for V1.
create function bitnode_private.plan_daily_rate(p_plan_id text,p_duration integer,p_day date)
returns numeric language plpgsql volatile set search_path='' as $$
declare v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans where id=p_plan_id;
  if v_plan.node_version=2 then
    return v_plan.rate_min + random()*(v_plan.rate_max-v_plan.rate_min);
  end if;
  return bitnode_private.monthly_daily_rate(p_duration,p_day);
end;
$$;
revoke all on function bitnode_private.plan_daily_rate(text,integer,date) from public,anon,authenticated;

do $patch_tasks$
declare v_before text:=pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure); v_after text;
begin
  if position('bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date)' in v_before)=0
     or position('v_effective_days >= v_contract.duration_days' in v_before)=0
     or position('America/Mexico_City' in v_before)=0 then
    raise exception 'El motor instalado no coincide con el motor verificado. No se aplicó Nodos 2.0.';
  end if;
  v_after:=replace(v_before,
    'bitnode_private.monthly_daily_rate(v_contract.duration_days, current_date)',
    'bitnode_private.plan_daily_rate(v_contract.plan_id, v_contract.duration_days, current_date)');
  if position('v_user_id, v_contract.id, current_date, v_rate, v_reward,' in v_after)=0 then
    raise exception 'No se encontró la fecha de acreditación del nodo.';
  end if;
  v_after:=replace(v_after,'v_user_id, v_contract.id, current_date, v_rate, v_reward,',
    'v_user_id, v_contract.id, case when v_contract.plan_id in (''v2-10d'',''v2-17d'',''v2-33d'') then (now() at time zone ''America/Mexico_City'')::date else current_date end, v_rate, v_reward,');
  execute v_after;
end;
$patch_tasks$;

-- Extend finite-ROI and capital handling with guarded generation predicates.
-- Keep recovery-debt logic, withdrawal schedules and commission rules intact.
do $patch_finite$
declare v_signature text; v_before text; v_after text; v_old text; v_new text;
begin
  foreach v_signature in array array[
    'bitnode_private.unspent_finite_node_roi(uuid)',
    'bitnode_private.withdrawal_source_buckets(uuid,timestamp with time zone)',
    'public.choose_finite_node_capital(uuid,text,text)'
  ] loop
    v_before:=pg_get_functiondef(v_signature::regprocedure);
    if v_signature like 'public.choose%' then
      v_old:='v_plan.duration_days in (7,14,21)';
      v_new:='(v_plan.duration_days in (7,14,21) or (v_plan.node_version=2 and v_plan.duration_days in (10,17,33)))';
    else
      v_old:='p.duration_days in (7,14,21)';
      v_new:='(p.duration_days in (7,14,21) or (p.node_version=2 and p.duration_days in (10,17,33)))';
    end if;
    if position(v_old in v_before)=0 then raise exception 'No se encontró el predicado esperado en %',v_signature; end if;
    v_after:=replace(v_before,v_old,v_new);
    execute v_after;
  end loop;
end;
$patch_finite$;

notify pgrst,'reload schema';
commit;
