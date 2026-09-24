-- The shared trigger must branch on TG_TABLE_NAME before referencing fields.
-- transactions has `type` but not `action`; capital choices has `action` but not `type`.
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
notify pgrst, 'reload schema';
