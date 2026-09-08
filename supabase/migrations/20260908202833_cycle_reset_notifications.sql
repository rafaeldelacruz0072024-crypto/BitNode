-- Persistent notices are created in the same transaction as an actual reset.
create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind = 'cycle_reset'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index user_notifications_unread_idx on public.user_notifications(user_id, created_at desc)
  where read_at is null;
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public, anon, authenticated;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
create policy notifications_read_own on public.user_notifications for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notifications_mark_own on public.user_notifications for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Patch only the known reset entry point; preserve its existing accounting.
do $migration$
declare
  source text := pg_get_functiondef('public.reset_daily_cycle_for_user(uuid,text)'::regprocedure);
  marker text := '  -- Solo se anulan ganancias provisionales.';
  addition text := $patch$
  -- Serialize duplicate reset attempts before deciding whether to notify.
  perform 1 from public.daily_task_cycles where user_id = p_user_id for update;
  if p_reason = 'missed_24h_window' then
    insert into public.user_notifications(user_id, kind)
    select p_user_id, 'cycle_reset'
    from public.daily_task_cycles
    where user_id = p_user_id
      and (cycle_day > 0 or cardinality(completed_tasks) > 0
        or window_started_at is not null or last_completed_at is not null);
  end if;
$patch$;
begin
  if position(marker in source) = 0 or position('public.user_notifications' in source) > 0 then
    raise exception 'Unexpected reset function; review before applying notification patch';
  end if;
  execute replace(source, marker, addition || marker);
end;
$migration$;
