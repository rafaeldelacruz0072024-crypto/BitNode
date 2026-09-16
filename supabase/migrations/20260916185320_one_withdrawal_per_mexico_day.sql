-- A withdrawal request consumes its Mexico City calendar day regardless of
-- later approval, rejection, or payment. The unique index resolves races.
begin;

alter table public.transactions add column withdrawal_day date;
update public.transactions
set withdrawal_day = (created_at at time zone 'America/Mexico_City')::date
where type = 'withdraw';

alter table public.transactions add constraint transactions_withdrawal_day_check
  check ((type = 'withdraw' and withdrawal_day is not null)
    or (type <> 'withdraw' and withdrawal_day is null));
create unique index transactions_one_withdrawal_per_mexico_day
  on public.transactions(user_id, withdrawal_day)
  where type = 'withdraw';

create function bitnode_private.set_withdrawal_day()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.withdrawal_day := case when new.type = 'withdraw'
    then (new.created_at at time zone 'America/Mexico_City')::date else null end;
  return new;
end;
$$;
revoke all on function bitnode_private.set_withdrawal_day() from public, anon, authenticated;
-- Runs after guard_reserved_ledger, which sets the final created_at and locks
-- the user's profile row before validating the withdrawal.
create trigger zz_set_withdrawal_day
  before insert or update of created_at, type, withdrawal_day on public.transactions
  for each row execute function bitnode_private.set_withdrawal_day();

do $patch$
declare
  source text := pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure);
  marker_pattern text := 'select[[:space:]]+value[[:space:]]+into[[:space:]]+v_window[[:space:]]+from[[:space:]]+public[.]platform_settings[[:space:]]+where[[:space:]]+key[[:space:]]*=[[:space:]]*''withdrawal_window'';';
  marker text;
  addition text := $check$
  if exists (
    select 1 from public.transactions t
    where t.user_id = p_user_id and t.type = 'withdraw'
      and t.withdrawal_day = (now() at time zone 'America/Mexico_City')::date
  ) then
    raise exception 'Solo puedes solicitar 1 retiro por día (hora de Ciudad de México). Intenta de nuevo mañana.' using errcode = 'P0001';
  end if;
$check$;
begin
  marker := substring(source from marker_pattern);
  if marker is null or position('t.withdrawal_day = ' in source) > 0 then
    raise exception 'Unexpected withdrawal validator; review before applying daily rule.';
  end if;
  execute replace(source, marker, addition || marker);
end;
$patch$;

notify pgrst, 'reload schema';
commit;
