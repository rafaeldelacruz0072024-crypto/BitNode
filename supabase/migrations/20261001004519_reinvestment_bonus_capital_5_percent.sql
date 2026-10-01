begin;

-- Reinvestment promotion: add 5% of the returned finite-node principal to the
-- new node as promotional principal. It is never posted to the spendable wallet.
create or replace function bitnode_private.apply_reinvestment_bonus()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_bonus numeric(18,2);
  v_updated integer;
begin
  if new.action <> 'reinvest' then
    return new;
  end if;

  v_bonus := round(new.amount * 0.05, 2);
  if v_bonus <= 0 then
    raise exception 'El capital es demasiado bajo para aplicar el bono promocional.' using errcode = 'P0001';
  end if;

  update public.contracts
  set amount = amount + v_bonus
  where id = new.new_contract_id
    and user_id = new.user_id
    and status = 'active'
    and amount = new.amount;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'No se pudo aplicar el bono al nuevo nodo.' using errcode = 'P0001';
  end if;

  update public.transactions
  set label = 'Reinversión + promoción 5% - ' || coalesce((select p.name from public.plans p join public.contracts c on c.plan_id = p.id where c.id = new.new_contract_id), 'nodo'),
      provider_status = 'finite_capital_reinvested:promo_5_percent'
  where id = new.new_contract_id
    and user_id = new.user_id
    and type = 'contract'
    and amount = -new.amount
    and provider_status = 'finite_capital_reinvested';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'No se pudo registrar la promoción de reinversión.' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;
revoke all on function bitnode_private.apply_reinvestment_bonus() from public, anon, authenticated;

drop trigger if exists apply_reinvestment_bonus on public.finite_node_capital_choices;
create trigger apply_reinvestment_bonus
before insert on public.finite_node_capital_choices
for each row execute function bitnode_private.apply_reinvestment_bonus();

notify pgrst, 'reload schema';
commit;
