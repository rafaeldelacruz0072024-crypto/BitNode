-- A selected leg follows that same edge all the way down. A placement with no
-- selected leg keeps the existing breadth-first search.
begin;

do $patch$
declare
  v_source text := pg_get_functiondef('public.place_network_node(uuid,uuid,text)'::regprocedure);
  v_start integer;
  v_finish integer;
  v_replacement text := $body$
  if p_preferred_leg is not null then
    v_parent_id := v_sponsor_id;
    loop
      select n.user_id into v_branch_root
      from public.network_nodes n
      where n.parent_id = v_parent_id and n.leg = p_preferred_leg;
      exit when v_branch_root is null;
      v_parent_id := v_branch_root;
    end loop;
    v_leg := p_preferred_leg;
  else
    v_branch_root := v_sponsor_id;
    with recursive tree as (
      select n.user_id, 0 as depth, array[]::integer[] as binary_path
      from public.network_nodes n where n.user_id = v_branch_root
      union all
      select child.user_id, tree.depth + 1,
             tree.binary_path || case child.leg when 'left' then 0 else 1 end
      from tree
      join public.network_nodes child on child.parent_id = tree.user_id
      where tree.depth < 100
    ), possible_slots as (
      select tree.user_id as parent_id, slots.leg, tree.depth,
             tree.binary_path || slots.sort_order as slot_path
      from tree
      cross join (values ('left'::text, 0), ('right'::text, 1)) as slots(leg, sort_order)
    )
    select possible_slots.parent_id, possible_slots.leg
    into v_parent_id, v_leg
    from possible_slots
    where not exists (
      select 1 from public.network_nodes occupied
      where occupied.parent_id = possible_slots.parent_id
        and occupied.leg = possible_slots.leg
        and occupied.user_id <> p_user_id
    )
    order by possible_slots.depth, possible_slots.slot_path
    limit 1;
  end if;

  $body$;
begin
  if position('lock table public.network_nodes in share row exclusive mode' in v_source) > 0
     and position('v_leg := p_preferred_leg' in v_source) > 0 then
    return;
  end if;
  v_start := position('if p_preferred_leg is not null then' in v_source);
  v_finish := position('if v_parent_id is null then raise exception' in v_source);
  if v_start = 0 or v_finish <= v_start
     or position('select * into v_existing from public.network_nodes' in v_source) = 0
     or position('lock table public.network_nodes in share row exclusive mode' in v_source) > 0 then
    raise exception 'Unexpected binary placement function; review before applying';
  end if;
  v_source := left(v_source, v_start - 1) || v_replacement || substring(v_source from v_finish);
  -- Serialize referrals from different sponsors that converge on one slot.
  v_source := replace(v_source,
    'select * into v_existing from public.network_nodes',
    'lock table public.network_nodes in share row exclusive mode;
  select * into v_existing from public.network_nodes');
  execute v_source;
end;
$patch$;

-- Repair the reported history only after verifying that moving these two
-- leaf accounts cannot alter an existing contract or source commission.
create schema if not exists binary_repair_private;
revoke all on schema binary_repair_private from public, anon, authenticated;
create table if not exists binary_repair_private.left_spine_backup (
  user_id uuid primary key,
  sponsor_id uuid,
  parent_id uuid,
  leg text,
  backed_up_at timestamptz not null default now()
);
alter table binary_repair_private.left_spine_backup enable row level security;
revoke all on binary_repair_private.left_spine_backup from public, anon, authenticated;

lock table public.network_nodes in access exclusive mode;
do $repair$
declare
  v_master uuid;
  v_yaz uuid;
  v_levi uuid;
  v_duck uuid;
  v_cod uuid;
begin
  select id into strict v_master from public.profiles where lower(username) = 'masteredu';
  select id into strict v_yaz from public.profiles where lower(username) = 'yazduran';
  select id into strict v_levi from public.profiles where lower(username) = 'leviduran';
  select id into strict v_duck from public.profiles where lower(username) = 'ducktail';
  select id into strict v_cod from public.profiles where lower(username) = 'codder';

  if exists (select 1 from public.network_nodes where user_id=v_duck and sponsor_id=v_master and parent_id=v_levi and leg='left')
     and exists (select 1 from public.network_nodes where user_id=v_cod and sponsor_id=v_master and parent_id=v_duck and leg='left')
     and (select count(*) from binary_repair_private.left_spine_backup where user_id in (v_duck,v_cod)) = 2 then
    return;
  end if;

  if not exists (select 1 from public.network_nodes where user_id=v_yaz and sponsor_id=v_master and parent_id=v_master and leg='left')
     or not exists (select 1 from public.network_nodes where user_id=v_levi and parent_id=v_yaz and leg='left')
     or not exists (select 1 from public.network_nodes where user_id=v_duck and sponsor_id=v_master and parent_id=v_yaz and leg='right')
     or not exists (select 1 from public.network_nodes where user_id=v_cod and sponsor_id=v_master and parent_id=v_levi and leg='left')
     or exists (select 1 from public.network_nodes where parent_id in (v_duck,v_cod))
     or exists (select 1 from public.contracts where user_id in (v_duck,v_cod))
     or exists (select 1 from public.commission_ledger where source_user_id in (v_duck,v_cod))
     or exists (select 1 from auth.users where id in (v_duck,v_cod) and raw_user_meta_data->>'preferred_leg' is distinct from 'left') then
    raise exception 'Masteredu branch changed or has financial activity; manual review required';
  end if;

  insert into binary_repair_private.left_spine_backup(user_id,sponsor_id,parent_id,leg)
  select user_id,sponsor_id,parent_id,leg from public.network_nodes where user_id in (v_duck,v_cod);
  if (select count(*) from binary_repair_private.left_spine_backup where user_id in (v_duck,v_cod)) <> 2 then
    raise exception 'Binary position backup incomplete';
  end if;

  update public.network_nodes set parent_id=v_duck, leg='left' where user_id=v_cod;
  update public.network_nodes set parent_id=v_levi, leg='left' where user_id=v_duck;
end;
$repair$;

do $verify$
begin
  if not exists (
    select 1 from public.network_nodes n
    join public.profiles p on p.id=n.user_id
    join public.profiles parent on parent.id=n.parent_id
    where p.username='ducktail' and parent.username='leviduran' and n.leg='left'
  ) or not exists (
    select 1 from public.network_nodes n
    join public.profiles p on p.id=n.user_id
    join public.profiles parent on parent.id=n.parent_id
    where p.username='codder' and parent.username='ducktail' and n.leg='left'
  ) or position('v_leg := p_preferred_leg' in
    pg_get_functiondef('public.place_network_node(uuid,uuid,text)'::regprocedure)) = 0 then
    raise exception 'Left-spine placement verification failed';
  end if;
end;
$verify$;
set constraints all immediate;

notify pgrst, 'reload schema';
commit;
