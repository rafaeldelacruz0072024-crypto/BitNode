-- Presentation overrides retain the actual creation timestamp and audit history.
alter table public.admin_payables
  add column display_date date,
  add column queue_after_id text;
