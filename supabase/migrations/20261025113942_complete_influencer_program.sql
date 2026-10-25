begin;

alter table public.influencer_packages
  add column if not exists purchase_method text,
  add column if not exists payment_reference text,
  add column if not exists paid_at timestamptz,
  add column if not exists cancel_reason text;

update public.influencer_packages
set purchase_method=coalesce(purchase_method,'manual'),
    payment_reference=coalesce(payment_reference,'LEGACY-'||id::text),
    paid_at=coalesce(paid_at,activated_at)
where status in ('active','paused','completed','expired','cancelled');

alter table public.influencer_packages drop constraint if exists influencer_purchase_method_check;
alter table public.influencer_packages add constraint influencer_purchase_method_check
  check(purchase_method is null or purchase_method in ('balance','manual','crypto'));
create unique index if not exists influencer_payment_reference_unique
  on public.influencer_packages(payment_reference) where payment_reference is not null;

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check(type in ('deposit','withdraw','contract','yield','influencer'));

create or replace function public.purchase_influencer_plan_from_balance(
  p_user_id uuid, p_plan_code text, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_plan public.influencer_plans%rowtype;
  v_package public.influencer_packages%rowtype;
  v_username text;
  v_balance numeric;
  v_transaction_id text := 'INFLUENCER-BUY-'||p_request_id::text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_user_id is null or p_request_id is null or nullif(trim(p_plan_code),'') is null then raise exception 'Solicitud inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended('influencer-purchase:'||p_user_id::text,0));
  select * into v_package from public.influencer_packages where payment_reference=v_transaction_id;
  if found then return jsonb_build_object('id',v_package.id,'status',v_package.status,'duplicate',true); end if;
  if exists(select 1 from public.influencer_packages where user_id=p_user_id and status in ('pending','active','paused')) then
    raise exception 'Ya tienes un paquete pendiente o activo' using errcode='P0001';
  end if;
  select * into v_plan from public.influencer_plans where code=p_plan_code and active for share;
  if not found then raise exception 'El paquete seleccionado no está disponible' using errcode='P0001'; end if;
  select username into v_username from public.profiles where id=p_user_id for no key update;
  if not found then raise exception 'Usuario no encontrado'; end if;
  select (public.get_account_ledger_summary(p_user_id)->>'balance')::numeric into v_balance;
  if coalesce(v_balance,0) < v_plan.price then raise exception 'Saldo disponible insuficiente' using errcode='P0001'; end if;
  insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
  values(v_transaction_id,p_user_id,v_username,'influencer','Compra paquete Influencers · '||v_plan.name,-v_plan.price,'completed','influencer_purchase:balance');
  insert into public.influencer_packages(user_id,plan_code,status,price,reward_rate,weekly_cap,reward_cap,starts_at,ends_at,activated_at,purchase_method,payment_reference,paid_at)
  values(p_user_id,v_plan.code,'active',v_plan.price,v_plan.reward_rate,v_plan.weekly_cap,v_plan.reward_cap,now(),now()+make_interval(days=>v_plan.duration_days),now(),'balance',v_transaction_id,now())
  returning * into v_package;
  return jsonb_build_object('id',v_package.id,'status',v_package.status,'plan_code',v_package.plan_code,'transaction_id',v_transaction_id,'balance',v_balance-v_plan.price);
end;
$$;
revoke all on function public.purchase_influencer_plan_from_balance(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.purchase_influencer_plan_from_balance(uuid,text,uuid) to service_role;

create or replace function public.admin_activate_influencer_package(
  p_admin_id uuid, p_package_id uuid, p_payment_method text, p_payment_reference text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_package public.influencer_packages%rowtype; v_plan public.influencer_plans%rowtype;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'Service role required'; end if;
  if not exists(select 1 from public.profiles where id=p_admin_id and role='admin') then raise exception 'Operator is not an admin'; end if;
  if p_payment_method not in ('manual','crypto') or length(trim(coalesce(p_payment_reference,''))) < 6 then raise exception 'Método y referencia de pago requeridos' using errcode='P0001'; end if;
  select * into v_package from public.influencer_packages where id=p_package_id for update;
  if not found or v_package.status<>'pending' then raise exception 'El paquete ya no está pendiente' using errcode='P0001'; end if;
  select * into v_plan from public.influencer_plans where code=v_package.plan_code;
  if not found then raise exception 'Plan no encontrado'; end if;
  update public.influencer_packages set status='active',starts_at=now(),ends_at=now()+make_interval(days=>v_plan.duration_days),
    activated_by=p_admin_id,activated_at=now(),purchase_method=p_payment_method,payment_reference=trim(p_payment_reference),paid_at=now(),updated_at=now()
  where id=p_package_id returning * into v_package;
  return jsonb_build_object('id',v_package.id,'user_id',v_package.user_id,'status',v_package.status,'duration_days',v_plan.duration_days);
exception when unique_violation then raise exception 'La referencia de pago ya fue utilizada' using errcode='P0001';
end;
$$;
revoke all on function public.admin_activate_influencer_package(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_activate_influencer_package(uuid,uuid,text,text) to service_role;

create or replace function public.create_influencer_submission(
  p_user_id uuid,p_platform text,p_story_url text,p_evidence_path text,p_campaign_code text,p_published_at timestamptz,p_reported_views bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_package public.influencer_packages%rowtype; v_id uuid; v_count integer; v_expected text; v_local_date date;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_platform not in ('instagram','facebook') or p_reported_views<0 or p_reported_views>10000000 then raise exception 'Evidencia inválida' using errcode='P0001'; end if;
  select * into v_package from public.influencer_packages where user_id=p_user_id and status='active' order by created_at desc limit 1 for update;
  if not found or v_package.ends_at<=now() then raise exception 'No tienes un paquete Influencers activo' using errcode='P0001'; end if;
  if p_published_at<v_package.starts_at or p_published_at>least(now()+interval '5 minutes',v_package.ends_at) or p_published_at<now()-interval '24 hours' then
    raise exception 'La historia debe pertenecer a las últimas 24 horas y al período activo' using errcode='P0001';
  end if;
  v_expected:='BN-'||upper(substr(replace(v_package.id::text,'-',''),1,6));
  if upper(trim(p_campaign_code))<>v_expected then raise exception 'Código de campaña inválido' using errcode='P0001'; end if;
  if p_evidence_path not like p_user_id::text||'/'||v_package.id::text||'/%' then raise exception 'Ruta de evidencia inválida' using errcode='P0001'; end if;
  v_local_date:=(p_published_at at time zone 'America/Mexico_City')::date;
  select count(*) into v_count from public.influencer_submissions where package_id=v_package.id and (story_published_at at time zone 'America/Mexico_City')::date=v_local_date;
  if v_count>=3 then raise exception 'Alcanzaste el máximo de 3 historias para ese día' using errcode='P0001'; end if;
  insert into public.influencer_submissions(package_id,user_id,platform,story_url,evidence_path,campaign_code,story_published_at,reported_views)
  values(v_package.id,p_user_id,p_platform,trim(p_story_url),p_evidence_path,v_expected,p_published_at,p_reported_views) returning id into v_id;
  return jsonb_build_object('id',v_id,'status','pending','campaign_code',v_expected);
end;
$$;
revoke all on function public.create_influencer_submission(uuid,text,text,text,text,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.create_influencer_submission(uuid,text,text,text,text,timestamptz,bigint) to service_role;

create or replace function public.admin_review_influencer_submission(
  p_admin_id uuid,p_submission_id uuid,p_decision text,p_verified_views bigint,p_note text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare s public.influencer_submissions%rowtype; p public.influencer_packages%rowtype; w public.influencer_weekly_payouts%rowtype;
  v_week_start date; v_week_end date; v_week_earned numeric(18,2); v_reward numeric(18,2):=0; v_now timestamptz:=now();
begin
  if p_decision not in ('approved','rejected') or p_verified_views<0 or length(trim(p_note))<3 then raise exception 'Datos de revisión inválidos'; end if;
  if not exists(select 1 from public.profiles where id=p_admin_id and role='admin') then raise exception 'Operator is not an admin'; end if;
  select * into s from public.influencer_submissions where id=p_submission_id for update;
  if not found or s.status<>'pending' then raise exception 'La evidencia ya fue revisada o no existe' using errcode='P0001'; end if;
  if p_decision='approved' and p_verified_views>s.reported_views then raise exception 'Las vistas verificadas no pueden superar las reportadas' using errcode='P0001'; end if;
  select * into p from public.influencer_packages where id=s.package_id for update;
  if not found or s.story_published_at<p.starts_at or s.story_published_at>p.ends_at then raise exception 'La historia está fuera del período activo' using errcode='P0001'; end if;
  v_week_start:=((s.story_published_at at time zone 'America/Mexico_City')::date-(extract(isodow from s.story_published_at at time zone 'America/Mexico_City')::int-1)); v_week_end:=v_week_start+6;
  select * into w from public.influencer_weekly_payouts where package_id=p.id and week_start=v_week_start for update;
  if found and w.status='credited' then raise exception 'La semana ya fue cerrada y acreditada' using errcode='P0001'; end if;
  select coalesce(sum(reward_amount),0) into v_week_earned from public.influencer_submissions where package_id=p.id and status='approved' and (story_published_at at time zone 'America/Mexico_City')::date between v_week_start and v_week_end;
  if p_decision='approved' then v_reward:=trunc(greatest(0,least(p_verified_views*p.reward_rate,p.weekly_cap-v_week_earned,p.reward_cap-p.earned_total)),2); end if;
  update public.influencer_submissions set status=p_decision,verified_views=p_verified_views,reward_amount=v_reward,reviewed_by=p_admin_id,reviewed_at=v_now,review_note=trim(p_note) where id=s.id;
  if p_decision='approved' then
    update public.influencer_packages set earned_total=earned_total+v_reward,verified_views=verified_views+p_verified_views,status=case when earned_total+v_reward>=reward_cap then 'completed' else status end,updated_at=v_now where id=p.id;
    insert into public.influencer_weekly_payouts(package_id,user_id,week_start,week_end,verified_views,amount,status)
    values(p.id,s.user_id,v_week_start,v_week_end,p_verified_views,v_reward,'pending')
    on conflict(package_id,week_start) do update set verified_views=public.influencer_weekly_payouts.verified_views+excluded.verified_views,amount=public.influencer_weekly_payouts.amount+excluded.amount where public.influencer_weekly_payouts.status='pending';
  end if;
  return jsonb_build_object('id',s.id,'package_id',p.id,'user_id',s.user_id,'status',p_decision,'reward_amount',v_reward,'week_start',v_week_start);
end;
$$;
revoke all on function public.admin_review_influencer_submission(uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.admin_review_influencer_submission(uuid,uuid,text,bigint,text) to service_role;

create or replace function public.settle_due_influencer_payouts()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare r public.influencer_weekly_payouts%rowtype; v_username text; v_count integer:=0; v_total numeric:=0; v_id text; v_today date:=(now() at time zone 'America/Mexico_City')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('settle-influencer-payouts',0));
  for r in select * from public.influencer_weekly_payouts where status in ('pending','approved') and week_end<v_today order by week_start,id for update skip locked loop
    if r.amount<=0 then update public.influencer_weekly_payouts set status='cancelled',credited_at=now() where id=r.id; continue; end if;
    select username into v_username from public.profiles where id=r.user_id;
    v_id:='INFLUENCER-PAYOUT-'||r.id::text;
    insert into public.transactions(id,user_id,username,type,label,amount,status,provider_status)
    values(v_id,r.user_id,v_username,'influencer','Bono Influencers · semana '||r.week_start::text,r.amount,'completed','influencer_weekly:'||r.id::text)
    on conflict(id) do nothing;
    update public.influencer_weekly_payouts set status='credited',transaction_id=v_id,credited_at=coalesce(credited_at,now()) where id=r.id;
    v_count:=v_count+1; v_total:=v_total+r.amount;
  end loop;
  update public.influencer_packages set status='expired',updated_at=now() where status in ('active','paused') and ends_at<=now();
  return jsonb_build_object('credited_count',v_count,'credited_total',v_total,'mexico_date',v_today);
end;
$$;
revoke all on function public.settle_due_influencer_payouts() from public,anon,authenticated;
grant execute on function public.settle_due_influencer_payouts() to service_role;

do $$
declare v_job bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    for v_job in select jobid from cron.job where jobname='bitnode-influencer-weekly-payouts' loop perform cron.unschedule(v_job); end loop;
    perform cron.schedule('bitnode-influencer-weekly-payouts','*/15 * * * *','select public.settle_due_influencer_payouts();');
  end if;
end $$;

notify pgrst,'reload schema';
commit;
