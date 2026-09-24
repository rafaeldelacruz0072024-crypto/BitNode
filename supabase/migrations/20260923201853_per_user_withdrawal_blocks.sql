create table if not exists public.withdrawal_restrictions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default 'Bloqueado por administración',
  blocked_by uuid not null references auth.users(id),
  blocked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.withdrawal_restrictions enable row level security;
revoke all on public.withdrawal_restrictions from public, anon, authenticated;
grant select, insert, update, delete on public.withdrawal_restrictions to service_role;

create or replace function bitnode_private.assert_withdrawals_allowed(p_user_id uuid)
returns void language plpgsql stable security invoker set search_path = '' as $$
declare v_reason text;
begin
  select reason into v_reason from public.withdrawal_restrictions where user_id = p_user_id;
  if found then
    raise exception 'Tus retiros están bloqueados por administración. Motivo: %', v_reason using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function bitnode_private.assert_withdrawals_allowed(uuid) from public, anon, authenticated;
grant execute on function bitnode_private.assert_withdrawals_allowed(uuid) to service_role;

-- Fail before creating an email challenge, while preserving the installed validator.
do $patch_validator$
declare
  source text := pg_get_functiondef('public.validate_withdrawal_request(uuid,numeric)'::regprocedure);
  marker_pattern text := 'select[[:space:]]+value[[:space:]]+into[[:space:]]+v_window[[:space:]]+from[[:space:]]+public[.]platform_settings[[:space:]]+where[[:space:]]+key[[:space:]]*=[[:space:]]*''withdrawal_window'';';
  marker text;
begin
  marker := substring(source from marker_pattern);
  if marker is null or position('assert_withdrawals_allowed' in source) > 0 then
    raise exception 'Unexpected withdrawal validator; review before applying per-user block.';
  end if;
  execute replace(source, marker,
    '  perform bitnode_private.assert_withdrawals_allowed(p_user_id);' || chr(10) || marker);
end;
$patch_validator$;

-- Final defense for any service-side writer that bypasses the validation RPC.
create or replace function bitnode_private.guard_user_withdrawal_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'transactions' then
    if new.type = 'withdraw' then
      perform bitnode_private.assert_withdrawals_allowed(new.user_id);
    end if;
  elsif tg_table_name = 'finite_node_capital_choices' then
    if new.action = 'claim' then
      perform bitnode_private.assert_withdrawals_allowed(new.user_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.guard_user_withdrawal_block() from public, anon, authenticated;

drop trigger if exists guard_user_withdrawal_block on public.transactions;
create trigger guard_user_withdrawal_block
  before insert on public.transactions
  for each row execute function bitnode_private.guard_user_withdrawal_block();

drop trigger if exists guard_user_capital_claim_block on public.finite_node_capital_choices;
create trigger guard_user_capital_claim_block
  before insert on public.finite_node_capital_choices
  for each row execute function bitnode_private.guard_user_withdrawal_block();

notify pgrst, 'reload schema';
