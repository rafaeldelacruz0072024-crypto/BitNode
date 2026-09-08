-- Compatibilidad para la función legacy complete_daily_task.
-- Los pasivos acreditados se registran como transactions.status = completed,
-- igual que los depósitos confirmados y los retiros liquidados.

do $$
declare
  v_constraint record;
begin
  -- El nombre puede variar entre instalaciones antiguas; elimina únicamente
  -- checks cuyo nombre o definición pertenecen a transactions.status.
  for v_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'transactions'
      and c.contype = 'c'
      and (
        c.conname = 'transactions_status_check'
        or pg_get_constraintdef(c.oid) ilike '%status%'
      )
  loop
    execute format('alter table public.transactions drop constraint if exists %I', v_constraint.conname);
  end loop;
end;
$$;

alter table public.transactions
  add constraint transactions_status_check
  check (status in ('pending', 'completed', 'reversed', 'failed', 'credited', 'confirmed'));

comment on constraint transactions_status_check on public.transactions is
  'Estados compatibles con depósitos, pasivos, comisiones, retiros y reversos.';
