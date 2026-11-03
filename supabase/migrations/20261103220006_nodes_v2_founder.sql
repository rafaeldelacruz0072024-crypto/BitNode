-- Founder enrollment is a closed cohort, established when this migration runs.
-- Eligibility is existing registration, not ownership of an active legacy node.
begin;
create table public.node_founder_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  source_contract_id text references public.contracts(id) on delete restrict,
  enrolled_at timestamptz not null default now()
);
alter table public.node_founder_members enable row level security;
revoke all on public.node_founder_members from public,anon,authenticated;
grant select on public.node_founder_members to service_role;

insert into public.node_founder_members(user_id,source_contract_id)
select u.id,(
  select c.id from public.contracts c join public.plans p on p.id=c.plan_id
  where c.user_id=u.id and p.node_version=1 and c.status in ('active','completed')
  order by c.created_at,c.id limit 1
)
from auth.users u where u.created_at<=now();

create function public.get_node_founder_eligibility(p_user_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.node_founder_members where user_id=p_user_id);
$$;
revoke all on function public.get_node_founder_eligibility(uuid) from public,anon,authenticated;
grant execute on function public.get_node_founder_eligibility(uuid) to service_role;

alter table public.plans drop constraint plans_v2_terms_check;
alter table public.plans add constraint plans_v2_terms_check check (node_version=1 or (
  cadence='business_days' and principal_returned and (
    (min_amount=10 and (
      (id='v2-10d' and duration_days=10 and rate_min=.005 and rate_max=.007) or
      (id='v2-17d' and duration_days=17 and rate_min=.008 and rate_max=.011) or
      (id='v2-33d' and duration_days=33 and rate_min=.013 and rate_max=.021)
    )) or
    (id='v2-founder' and duration_days=33 and rate_min=.02 and rate_max=.02 and min_amount=2000.01)
  )
));
insert into public.plans(id,name,slug,rate_min,rate_max,cadence,duration_days,min_amount,principal_returned,active,node_version)
values('v2-founder','Nodo Founder','nodo-founder',.02,.02,'business_days',33,2000.01,true,false,2);

-- Insert guard covers purchases and same-plan reinvestments alike.
do $guard$
declare v_before text:=pg_get_functiondef('bitnode_private.guard_nodes_v2_contract()'::regprocedure); v_after text;
begin
  if position('if v_plan.node_version=2 then' in v_before)=0 then
    raise exception 'No se encontró el control de generación de Nodos 2.0.';
  end if;
  v_after:=replace(v_before,'if v_plan.node_version=2 then',
    $patch$if v_plan.node_version=2 then
    if v_plan.id='v2-founder' then
      if not public.get_node_founder_eligibility(new.user_id) then
        raise exception 'Nodo Founder es exclusivo para socios registrados antes de su incorporación.' using errcode='P0001';
      end if;
      if new.amount is null or new.amount::text in ('NaN','Infinity','-Infinity') or new.amount<=2000 then
        raise exception 'Nodo Founder requiere una inversión mayor de 2,000 USDT.' using errcode='P0001';
      end if;
    end if;$patch$);
  execute v_after;
end;
$guard$;

do $tasks$
declare v_before text:=pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure); v_after text;
begin
  if position('v_contract.plan_id in (''v2-10d'',''v2-17d'',''v2-33d'')' in v_before)=0 then
    raise exception 'No se encontró la fecha de acreditación de Nodos 2.0.';
  end if;
  v_after:=replace(v_before,
    'v_contract.plan_id in (''v2-10d'',''v2-17d'',''v2-33d'')',
    'v_contract.plan_id in (''v2-10d'',''v2-17d'',''v2-33d'',''v2-founder'')');
  execute v_after;
end;
$tasks$;
notify pgrst,'reload schema';
commit;
