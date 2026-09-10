-- Restore Luisnug1943's historical direct sponsorships and place every direct
-- account inside his binary subtree. The global root and all attached
-- descendants are preserved.
begin;

lock table public.network_nodes in access exclusive mode;

create schema if not exists binary_repair_private;
revoke all on schema binary_repair_private from public, anon, authenticated;

create table if not exists binary_repair_private.luisnug1943_directs_backup (
  user_id uuid primary key,
  sponsor_id uuid,
  profile_sponsor_id uuid,
  parent_id uuid,
  leg text,
  saved_at timestamptz not null default now()
);
revoke all on binary_repair_private.luisnug1943_directs_backup
  from public, anon, authenticated;

do $$
declare
  v_luis_id constant uuid := 'd360b1b5-64da-403d-94c3-b65fb15170f6';
  v_expected_direct_ids constant uuid[] := array[
    '99331595-c002-4a2b-9087-01fd22bf292a'::uuid, -- gentecash
    '1254e24c-227c-4f73-a390-26238ccd4ec8'::uuid, -- joselvas
    'efbe30e4-46cf-44df-bf47-ea27d80f4094'::uuid, -- lider02
    '8e32a176-6f59-4f2a-ad8e-51d388153b76'::uuid, -- lider03
    '88d09cb1-2d2a-4007-beff-e515e5fb5158'::uuid, -- lider04
    '350b833f-50c8-453b-9921-91626704a230'::uuid, -- lider05
    '25f31971-ae09-416f-8256-cef4e51e0a06'::uuid, -- lider06
    'c3f011f8-d572-4839-882e-8fdca9d06529'::uuid, -- lider07
    'aff0b2e1-e589-46b4-a432-dfd67320351e'::uuid, -- lider08
    '80dbfaba-12f2-4097-bf9e-54fcf9d116d2'::uuid, -- lider09
    '64e91633-b59b-4ec9-8a1b-5d75f8531cb2'::uuid  -- lider10
  ];
  v_member record;
  v_destination uuid;
  v_destination_leg text;
  v_count integer;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_luis_id and lower(username) = lower('Luisnug1943')
  ) then
    raise exception 'Luisnug1943 profile was not found with the verified id';
  end if;

  if (select count(*) from public.network_nodes where user_id = any(v_expected_direct_ids)) <> 11 then
    raise exception 'Expected all 11 historical direct accounts to exist';
  end if;

  if exists (select 1 from binary_repair_private.luisnug1943_directs_backup) then
    raise exception 'Luisnug1943 repair was already executed; inspect its backup before rerunning';
  end if;

  insert into binary_repair_private.luisnug1943_directs_backup(
    user_id, sponsor_id, profile_sponsor_id, parent_id, leg
  )
  select n.user_id, n.sponsor_id, p.sponsor_id, n.parent_id, n.leg
  from public.network_nodes n
  left join public.profiles p on p.id = n.user_id;

  -- Sponsorship controls direct commissions; binary parent controls placement.
  update public.profiles
  set sponsor_id = v_luis_id
  where id = any(v_expected_direct_ids);

  update public.network_nodes
  set sponsor_id = v_luis_id
  where user_id = any(v_expected_direct_ids);

  -- Detach the selected accounts together. Their unselected descendants remain
  -- attached and travel with their respective subtree when the root is moved.
  update public.network_nodes
  set parent_id = null, leg = null
  where user_id = any(v_expected_direct_ids);

  for v_member in
    select n.user_id,
           row_number() over (order by u.created_at, n.created_at, n.user_id) as sequence
    from public.network_nodes n
    join auth.users u on u.id = n.user_id
    where n.user_id = any(v_expected_direct_ids)
    order by sequence
  loop
    v_destination := null;
    v_destination_leg := null;

    with recursive luis_tree as (
      select n.user_id, 0 as depth, array[]::integer[] as route,
             array[n.user_id]::uuid[] as path
      from public.network_nodes n
      where n.user_id = v_luis_id
      union all
      select child.user_id, tree.depth + 1,
             tree.route || case child.leg when 'left' then 0 else 1 end,
             tree.path || child.user_id
      from luis_tree tree
      join public.network_nodes child on child.parent_id = tree.user_id
      where not child.user_id = any(tree.path)
    )
    select tree.user_id, slot.leg
    into v_destination, v_destination_leg
    from luis_tree tree
    cross join (values ('left'::text, 0), ('right'::text, 1)) slot(leg, sort_order)
    where not exists (
      select 1 from public.network_nodes occupied
      where occupied.parent_id = tree.user_id and occupied.leg = slot.leg
    )
    order by tree.depth, tree.route, slot.sort_order
    limit 1;

    if v_destination is null then
      raise exception 'No free binary position exists below Luisnug1943';
    end if;

    update public.network_nodes
    set parent_id = v_destination, leg = v_destination_leg
    where user_id = v_member.user_id;
  end loop;

  select count(*) into v_count
  from public.network_nodes n
  join public.profiles p on p.id = n.user_id
  where n.sponsor_id = v_luis_id and p.sponsor_id = v_luis_id;

  if v_count <> 11 then
    raise exception 'Expected 11 synchronized direct accounts for Luisnug1943, found %', v_count;
  end if;

  if exists (
    with recursive luis_tree as (
      select n.user_id, array[n.user_id]::uuid[] as path
      from public.network_nodes n where n.user_id = v_luis_id
      union all
      select child.user_id, tree.path || child.user_id
      from luis_tree tree
      join public.network_nodes child on child.parent_id = tree.user_id
      where not child.user_id = any(tree.path)
    )
    select 1
    from unnest(v_expected_direct_ids) direct_id
    where not exists (select 1 from luis_tree where user_id = direct_id)
  ) then
    raise exception 'At least one direct account remains outside Luisnug1943 binary subtree';
  end if;

  if (select count(*) from public.network_nodes where parent_id is null) <> 1 then
    raise exception 'The repair must preserve exactly one global root';
  end if;
end;
$$;

with recursive luis_tree as (
  select n.user_id, n.parent_id, n.leg, 0 as depth,
         array[n.user_id]::uuid[] as path
  from public.network_nodes n
  where n.user_id = 'd360b1b5-64da-403d-94c3-b65fb15170f6'
  union all
  select child.user_id, child.parent_id, child.leg, tree.depth + 1,
         tree.path || child.user_id
  from luis_tree tree
  join public.network_nodes child on child.parent_id = tree.user_id
  where not child.user_id = any(tree.path)
), direct_accounts as (
  select n.user_id, p.username, n.parent_id, n.leg, tree.depth
  from public.network_nodes n
  join public.profiles p on p.id = n.user_id
  join luis_tree tree on tree.user_id = n.user_id
  where n.sponsor_id = 'd360b1b5-64da-403d-94c3-b65fb15170f6'
    and p.sponsor_id = 'd360b1b5-64da-403d-94c3-b65fb15170f6'
)
select
  count(*) over () as luis_direct_accounts,
  username,
  parent_id,
  leg,
  depth,
  'LUIS_DIRECT_INSIDE_BINARY_OK' as verification
from direct_accounts
order by depth, case leg when 'left' then 0 else 1 end, username;

commit;
