-- BitNode: historial de depósitos y retiros.
-- Ejecutar en Supabase SQL Editor. La anon key no permite crear tablas por REST.
create table if not exists public.transactions (
  id text primary key,
  username text not null,
  type text not null check (type in ('deposit', 'withdraw', 'contract', 'yield')),
  label text not null,
  amount numeric(18,2) not null,
  status text not null check (status in ('completed', 'pending', 'failed')),
  network text,
  wallet text,
  fee numeric(18,2),
  net_amount numeric(18,2),
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

-- Política temporal para el prototipo local identificado por username.
-- Antes de producción debe sustituirse por auth.uid() y una columna user_id uuid.
drop policy if exists "transactions_public_insert" on public.transactions;
create policy "transactions_public_insert" on public.transactions for insert to anon with check (char_length(username) between 1 and 80);

drop policy if exists "transactions_public_select" on public.transactions;
create policy "transactions_public_select" on public.transactions for select to anon using (char_length(username) between 1 and 80);

create index if not exists transactions_username_created_at_idx on public.transactions (username, created_at desc);
