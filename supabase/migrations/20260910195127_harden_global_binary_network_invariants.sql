-- Deferred integrity guard for the single global binary network. It validates
-- the final transaction state so legitimate multi-row placement operations can
-- finish before the graph is checked.
begin;

create schema if not exists binary_repair_private;
revoke all on schema binary_repair_private from public, anon, authenticated;

create or replace function binary_repair_private.assert_global_binary_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, binary_repair_private
as $$
declare
  v_root_id constant uuid := '1d49e94b-381e-41a3-92b8-7441d0f6508e';
  v_total integer;
  v_connected integer;
begin
  if not exists (
    select 1 from public.network_nodes as root_node
    where root_node.user_id = v_root_id
      and root_node.parent_id is null
      and root_node.leg is null
      and root_node.sponsor_id is null
  ) then
    raise exception 'Binary integrity: verified principal root is missing or malformed';
  end if;

  if (select count(*) from public.network_nodes as candidate where candidate.parent_id is null) <> 1 then
    raise exception 'Binary integrity: the global network must have exactly one root';
  end if;

  if exists (
    select 1 from public.network_nodes as node
    where (node.user_id = v_root_id and (node.parent_id is not null or node.leg is not null))
       or (node.user_id <> v_root_id and (node.parent_id is null or node.leg not in ('left', 'right')))
  ) then
    raise exception 'Binary integrity: every non-root account requires one parent and one valid leg';
  end if;

  if exists (
    select 1
    from public.network_nodes as node
    join public.profiles as profile on profile.id = node.user_id
    where node.sponsor_id is distinct from profile.sponsor_id
  ) then
    raise exception 'Binary integrity: profile and network sponsors must match';
  end if;

  select count(*) into v_total from public.network_nodes;

  with recursive global_tree as (
    select root_node.user_id, array[root_node.user_id]::uuid[] as path
    from public.network_nodes as root_node
    where root_node.user_id = v_root_id
    union all
    select child.user_id, tree.path || child.user_id
    from global_tree as tree
    join public.network_nodes as child on child.parent_id = tree.user_id
    where not child.user_id = any(tree.path)
  )
  select count(*) into v_connected from global_tree;

  if v_connected <> v_total then
    raise exception 'Binary integrity: disconnected node or parent cycle detected (% of % connected)', v_connected, v_total;
  end if;

  if exists (
    with recursive global_tree as (
      select root_node.user_id, array[root_node.user_id]::uuid[] as path
      from public.network_nodes as root_node
      where root_node.user_id = v_root_id
      union all
      select child.user_id, tree.path || child.user_id
      from global_tree as tree
      join public.network_nodes as child on child.parent_id = tree.user_id
      where not child.user_id = any(tree.path)
    )
    select 1
    from public.network_nodes as node
    join global_tree as tree on tree.user_id = node.user_id
    where node.sponsor_id is not null
      and node.sponsor_id <> node.user_id
      and not node.sponsor_id = any(tree.path)
  ) then
    raise exception 'Binary integrity: a sponsor exists outside its member binary ancestry';
  end if;

  return null;
end;
$$;

revoke all on function binary_repair_private.assert_global_binary_integrity()
  from public, anon, authenticated;

drop trigger if exists enforce_global_binary_integrity on public.network_nodes;
create constraint trigger enforce_global_binary_integrity
after insert or update or delete on public.network_nodes
deferrable initially deferred
for each row
execute function binary_repair_private.assert_global_binary_integrity();

drop trigger if exists enforce_global_binary_integrity on public.profiles;
create constraint trigger enforce_global_binary_integrity
after update of sponsor_id on public.profiles
deferrable initially deferred
for each row
execute function binary_repair_private.assert_global_binary_integrity();

-- Validate the current production topology while installing the guard.
update public.network_nodes as root_node
set leg = root_node.leg
where root_node.user_id = '1d49e94b-381e-41a3-92b8-7441d0f6508e';
set constraints enforce_global_binary_integrity immediate;

with recursive global_tree as (
  select root_node.user_id, array[root_node.user_id]::uuid[] as path
  from public.network_nodes as root_node
  where root_node.user_id = '1d49e94b-381e-41a3-92b8-7441d0f6508e'
  union all
  select child.user_id, tree.path || child.user_id
  from global_tree as tree
  join public.network_nodes as child on child.parent_id = tree.user_id
  where not child.user_id = any(tree.path)
)
select
  (select count(*) from public.network_nodes) as total_nodes,
  (select count(*) from global_tree) as connected_nodes,
  (select count(*) from public.network_nodes as node where node.parent_id is null) as roots,
  (select count(*) from public.network_nodes as node
     join public.profiles as profile on profile.id = node.user_id
   where node.sponsor_id is distinct from profile.sponsor_id) as sponsor_mismatches,
  'BINARY_INTEGRITY_GUARD_ACTIVE' as verification;

commit;
