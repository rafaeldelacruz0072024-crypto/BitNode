begin;

create function bitnode_private.block_new_legacy_contracts()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.plans where id=new.plan_id and node_version=1) then
    raise exception 'Los Nodos 1.0 ya no admiten compras ni reinversiones. Elige un Nodo 2.0.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function bitnode_private.block_new_legacy_contracts() from public,anon,authenticated;
create trigger block_new_legacy_contracts before insert on public.contracts
for each row execute function bitnode_private.block_new_legacy_contracts();

commit;
