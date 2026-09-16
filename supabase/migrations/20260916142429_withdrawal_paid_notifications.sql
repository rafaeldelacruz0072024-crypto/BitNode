-- One persistent notice, committed atomically with the paid transition.
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_check
  check (kind in ('cycle_reset', 'withdrawal_paid'));
alter table public.user_notifications add column withdrawal_id text references public.transactions(id);
create unique index user_notifications_paid_once
  on public.user_notifications(withdrawal_id) where kind = 'withdrawal_paid';

create or replace function public.notify_paid_withdrawal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.type = 'withdraw' and new.status = 'completed'
     and old.status is distinct from 'completed' then
    insert into public.user_notifications(user_id, kind, withdrawal_id)
    values (new.user_id, 'withdrawal_paid', new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_paid_withdrawal() from public, anon, authenticated;
drop trigger if exists notify_paid_withdrawal on public.transactions;
create trigger notify_paid_withdrawal after update of status on public.transactions
for each row execute function public.notify_paid_withdrawal();
