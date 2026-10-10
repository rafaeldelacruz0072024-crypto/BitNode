begin;
create table public.sara_ia_manual_activations (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id),
  admin_id uuid not null references auth.users(id),
  reason text not null check(length(reason) between 5 and 500),
  previous_expiry timestamptz,
  new_expiry timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.sara_ia_manual_activations enable row level security;
revoke all on public.sara_ia_manual_activations from public, anon, authenticated;
grant select on public.sara_ia_manual_activations to service_role;

create function public.admin_activate_sara_ia(p_admin_id uuid, p_user_id uuid, p_request_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.sara_ia_manual_activations%rowtype;
  v_previous timestamptz;
  v_expiry timestamptz;
  v_username text;
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='admin') then
    raise exception 'Administrador requerido';
  end if;
  if p_request_id is null or length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Solicitud y motivo válidos requeridos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_existing from public.sara_ia_manual_activations where request_id=p_request_id;
  if found then
    if v_existing.admin_id<>p_admin_id or v_existing.user_id<>p_user_id or v_existing.reason<>trim(p_reason) then
      raise exception 'Solicitud ya utilizada para otra operación';
    end if;
    return jsonb_build_object('paidThroughAt',v_existing.new_expiry,'replayed',true);
  end if;
  perform 1 from auth.users where id=p_user_id for update;
  if not found then raise exception 'Usuario no encontrado'; end if;
  if not bitnode_private.has_active_sara_node(p_user_id) then
    raise exception 'Requiere nodo de 21 días activo';
  end if;
  select paid_through_at into v_previous from public.sara_ia_subscriptions where user_id=p_user_id for update;
  insert into public.sara_ia_subscriptions(user_id,paid_through_at)
    values(p_user_id,now()+interval '30 days')
    on conflict(user_id) do update set
      paid_through_at=greatest(public.sara_ia_subscriptions.paid_through_at,now())+interval '30 days',updated_at=now()
    returning paid_through_at into v_expiry;
  insert into public.sara_ia_manual_activations values(p_request_id,p_user_id,p_admin_id,trim(p_reason),v_previous,v_expiry,now());
  select username into v_username from public.profiles where id=p_admin_id;
  insert into public.admin_operation_audit_log(admin_id,admin_username,action,target_type,target_id,details)
    values(p_admin_id,v_username,'sara_manual_activation','sara_subscription',p_user_id::text,
      jsonb_build_object('request_id',p_request_id,'reason',trim(p_reason),'days',30,'previous_expiry',v_previous,'new_expiry',v_expiry,'payment_created',false));
  return jsonb_build_object('paidThroughAt',v_expiry,'replayed',false);
end;
$$;
revoke all on function public.admin_activate_sara_ia(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_activate_sara_ia(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
