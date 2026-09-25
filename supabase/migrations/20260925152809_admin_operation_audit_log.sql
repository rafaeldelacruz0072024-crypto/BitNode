create table if not exists public.admin_operation_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id),
  admin_email text,
  admin_username text,
  action text not null check (length(action) between 3 and 80),
  target_type text not null check (length(target_type) between 2 and 80),
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_operation_audit_log_created_at_idx
  on public.admin_operation_audit_log (created_at desc);
create index if not exists admin_operation_audit_log_admin_id_idx
  on public.admin_operation_audit_log (admin_id, created_at desc);

alter table public.admin_operation_audit_log enable row level security;
revoke all on public.admin_operation_audit_log from public, anon, authenticated;
grant select, insert on public.admin_operation_audit_log to service_role;
grant usage, select on sequence public.admin_operation_audit_log_id_seq to service_role;

comment on table public.admin_operation_audit_log is
  'Immutable server-side audit trail for successful administrative mutations.';
