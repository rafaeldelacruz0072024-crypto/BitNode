-- Ejecutar en el SQL Editor de Supabase después de habilitar Email Auth.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.transactions
  ALTER COLUMN username DROP NOT NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_status text;

CREATE INDEX IF NOT EXISTS transactions_user_id_created_at_idx
  ON public.transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS transactions_provider_payment_id_idx
  ON public.transactions (provider_payment_id);

DROP POLICY IF EXISTS "transactions_public_insert" ON public.transactions;
DROP POLICY IF EXISTS "transactions_public_select" ON public.transactions;
DROP POLICY IF EXISTS "transactions_authenticated_insert" ON public.transactions;
DROP POLICY IF EXISTS "transactions_authenticated_select" ON public.transactions;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_authenticated_insert"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions_authenticated_select"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "transactions_authenticated_update"
  ON public.transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON COLUMN public.transactions.user_id IS 'Supabase Auth user ID; all authenticated transaction access is scoped with auth.uid().';
