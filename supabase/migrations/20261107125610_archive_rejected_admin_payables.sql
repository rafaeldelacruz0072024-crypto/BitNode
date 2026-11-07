alter table public.admin_payables
  add column if not exists archived_at timestamptz;

alter table public.admin_payables
  add constraint admin_payables_archive_only_rejected
  check (archived_at is null or status = 'rejected');
