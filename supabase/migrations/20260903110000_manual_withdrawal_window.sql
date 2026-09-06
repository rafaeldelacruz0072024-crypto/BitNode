-- Ventana controlada por administración para pruebas de retiros.
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value)
values ('withdrawal_window', '{"enabled": false, "mode": "manual_test"}'::jsonb)
on conflict (key) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
