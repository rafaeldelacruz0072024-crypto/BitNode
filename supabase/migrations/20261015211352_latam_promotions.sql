begin;
-- Promotion accounting is separate from wallets: no balances or prizes are credited.
create table public.latam_promotion_sales (
 id uuid primary key default gen_random_uuid(),
 contract_id text not null references public.contracts(id),
 deposit_id text not null references public.transactions(id),
 sponsor_id uuid not null references public.profiles(id),
 amount numeric(18,2) not null check(amount>0),
 admin_id uuid not null references public.profiles(id),
 reason text not null check(length(reason) between 10 and 500),
 validated_at timestamptz not null default now(),
 revoked_at timestamptz,
 unique(contract_id,deposit_id)
);
alter table public.latam_promotion_sales enable row level security;
revoke all on public.latam_promotion_sales from anon,authenticated;
create index latam_promotion_sponsor_idx on public.latam_promotion_sales(sponsor_id,validated_at);

create or replace view bitnode_private.latam_valid_sales as
select s.* from public.latam_promotion_sales s
join public.contracts c on c.id=s.contract_id
join public.transactions t on t.id=c.id and t.user_id=c.user_id
join public.transactions d on d.id=s.deposit_id and d.user_id=c.user_id
where s.revoked_at is null
and c.created_at >= timestamptz '2026-10-16 00:00 America/Mexico_City'
and c.created_at < timestamptz '2026-11-26 00:00 America/Mexico_City'
and c.status in ('active','completed')
and t.type='contract' and t.status='completed' and t.amount<0
and d.type='deposit' and d.status='completed' and d.amount>0
and d.created_at >= timestamptz '2026-10-16 00:00 America/Mexico_City'
and d.created_at <= c.created_at
and ((d.id like 'NP-%' and d.provider_payment_id is not null and d.provider_status in ('confirmed','finished'))
 or (d.id like 'ADMIN-%' and d.provider_status like 'admin_manual:%'))
and c.id not like 'REINVEST-%'
and coalesce(t.provider_status,'') not like 'finite_capital_reinvested%'
and not exists(select 1 from public.finite_node_capital_choices f where f.new_contract_id=c.id and f.action='reinvest');
revoke all on bitnode_private.latam_valid_sales from public,anon,authenticated;

create function public.admin_validate_latam_sale(p_admin_id uuid,p_contract_id text,p_deposit_id text,p_amount numeric,p_reason text,p_revoke boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contracts%rowtype; d public.transactions%rowtype; v_sponsor uuid; v_name text;
begin
 if not exists(select 1 from public.profiles where id=p_admin_id and role='admin') then raise exception 'Administrador requerido'; end if;
 if p_reason is null or length(trim(p_reason)) not between 10 and 500 then raise exception 'Escribe un motivo de 10 a 500 caracteres'; end if;
 -- Serializes allocations across deposits AND contracts, preventing double counting.
 perform pg_advisory_xact_lock(731590022);
 if p_revoke then
  update public.latam_promotion_sales set revoked_at=now() where contract_id=p_contract_id and deposit_id=p_deposit_id and revoked_at is null;
  if not found then raise exception 'Validación no encontrada o ya revocada'; end if;
 else
  select * into c from public.contracts where id=p_contract_id for update;
  if not found then raise exception 'Nodo no encontrado'; end if;
  select * into d from public.transactions where id=p_deposit_id for update;
  if not found or d.user_id<>c.user_id then raise exception 'El depósito debe pertenecer al comprador del nodo'; end if;
  select sponsor_id into v_sponsor from public.profiles where id=c.user_id;
  if v_sponsor is null then raise exception 'El comprador no tiene patrocinador directo'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Importe positivo con máximo 2 decimales requerido'; end if;
  if p_amount+coalesce((select sum(amount) from public.latam_promotion_sales where contract_id=c.id and revoked_at is null),0)>c.amount
   or p_amount+coalesce((select sum(amount) from public.latam_promotion_sales where deposit_id=d.id and revoked_at is null),0)>d.amount then
   raise exception 'Importe supera el capital del nodo o depósito disponible para esta promoción';
  end if;
  insert into public.latam_promotion_sales(contract_id,deposit_id,sponsor_id,amount,admin_id,reason)
   values(c.id,d.id,v_sponsor,p_amount,p_admin_id,trim(p_reason));
  if not exists(select 1 from bitnode_private.latam_valid_sales where contract_id=c.id and deposit_id=d.id) then
   raise exception 'No elegible: revisa fechas, estado, fuente confirmada y exclusión de reinversiones';
  end if;
 end if;
 select username into v_name from public.profiles where id=p_admin_id;
 insert into public.admin_operation_audit_log(admin_id,admin_username,action,target_type,target_id,details)
 values(p_admin_id,v_name,case when p_revoke then 'promotion_sale_revoked' else 'promotion_sale_validated' end,'promotion_sale',p_contract_id,
 jsonb_build_object('deposit_id',p_deposit_id,'amount',p_amount,'reason',trim(p_reason),'campaign','latam-2026'));
 return jsonb_build_object('saved',true);
end;
$$;

create function public.get_latam_promotion(p_user_id uuid,p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'Usuario requerido'; end if;
 if p_admin and not exists(select 1 from public.profiles where id=p_user_id and role='admin') then raise exception 'Administrador requerido'; end if;
 with running as (
  select sponsor_id,validated_at,id,sum(amount) over(partition by sponsor_id order by validated_at,id) total
  from bitnode_private.latam_valid_sales
 ), qualified as (
  select sponsor_id,min(validated_at) qualified_at from running where total>=15000 group by sponsor_id
 ), ranked as (
  select q.*,row_number() over(order by qualified_at,sponsor_id) position from qualified q
 )
 select jsonb_build_object('total',coalesce((select sum(amount) from bitnode_private.latam_valid_sales where sponsor_id=p_user_id),0),
 'winners',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'username',p.username,'qualifiedAt',r.qualified_at) order by r.position)
 from ranked r join public.profiles p on p.id=r.sponsor_id where r.position<=10),'[]'::jsonb),
 'validations',case when p_admin then coalesce((select jsonb_agg(to_jsonb(s) order by s.validated_at desc) from public.latam_promotion_sales s),'[]'::jsonb) else '[]'::jsonb end)
 into result;
 return result;
end;
$$;
revoke all on function public.admin_validate_latam_sale(uuid,text,text,numeric,text,boolean) from public,anon,authenticated;
revoke all on function public.get_latam_promotion(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_validate_latam_sale(uuid,text,text,numeric,text,boolean) to service_role;
grant execute on function public.get_latam_promotion(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
