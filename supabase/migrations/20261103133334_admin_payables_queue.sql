-- Separate company payables from the earned-commission ledger.
-- No account balance, referral volume, or user authentication is created here.
create table public.admin_payables (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  username text not null check (length(trim(username)) between 1 and 80),
  recipient_email text not null,
  amount numeric(18,2) not null check (amount > 0 and amount < 100000000),
  fee numeric(18,2) not null check (fee = round(greatest(1, amount * 0.05), 2)),
  net_amount numeric(18,2) not null check (net_amount > 0 and net_amount = amount - fee),
  network text not null default 'BNB Chain' check (network = 'BNB Chain'),
  wallet text not null check (wallet ~ '^0x[a-fA-F0-9]{40}$'),
  status text not null default 'pending' check (status in ('pending','approved','completed','rejected')),
  internal_reason text not null check (length(trim(internal_reason)) >= 10),
  authorized_by uuid not null references public.profiles(id),
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_payables enable row level security;
revoke all on public.admin_payables from public, anon, authenticated;
grant select, insert on public.admin_payables to service_role;

create table public.admin_payable_events (
  id bigint generated always as identity primary key,
  payable_id uuid not null references public.admin_payables(id),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.admin_payable_events enable row level security;
revoke all on public.admin_payable_events from public, anon, authenticated;
grant select on public.admin_payable_events to service_role;

create function bitnode_private.audit_admin_payable_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'pending' or not exists (select 1 from public.profiles where id=new.authorized_by and role='admin') then
    raise exception 'Se requiere autorización administrativa y estado pendiente.';
  end if;
  insert into public.admin_payable_events(payable_id,actor_id,action,details)
  values(new.id,new.authorized_by,'created',to_jsonb(new));
  return new;
end;
$$;
revoke all on function bitnode_private.audit_admin_payable_creation() from public, anon, authenticated;
create trigger audit_admin_payable_creation after insert on public.admin_payables
for each row execute function bitnode_private.audit_admin_payable_creation();

create function public.manage_admin_payable(p_id uuid,p_action text,p_admin_id uuid,p_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.admin_payables%rowtype; v_status text;
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='admin') then
    raise exception 'Se requiere un administrador.' using errcode='P0001';
  end if;
  select * into v_row from public.admin_payables where id=p_id for update;
  if not found then raise exception 'Pago no encontrado.' using errcode='P0001'; end if;
  v_status := case
    when p_action='approve' and v_row.status='pending' then 'approved'
    when p_action='mark_paid' and v_row.status='approved' then 'completed'
    when p_action='reject' and v_row.status in ('pending','approved') then 'rejected'
    else null end;
  if v_status is null then raise exception 'La solicitud no permite esta acción en su estado actual.' using errcode='P0001'; end if;
  if v_status='completed' and nullif(trim(p_reference),'') is null then
    raise exception 'Introduce el TXID o referencia del pago realizado.' using errcode='P0001';
  end if;
  update public.admin_payables set status=v_status,reference=p_reference,updated_at=now() where id=p_id;
  insert into public.admin_payable_events(payable_id,actor_id,action,details)
  values(p_id,p_admin_id,p_action,jsonb_build_object('from',v_row.status,'to',v_status,'reference',p_reference));
  return jsonb_build_object('status',v_status);
end;
$$;
revoke all on function public.manage_admin_payable(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.manage_admin_payable(uuid,text,uuid,text) to service_role;
