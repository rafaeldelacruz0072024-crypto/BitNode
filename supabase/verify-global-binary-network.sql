-- Read-only health check. Safe to run after any binary placement or sponsor repair.
with recursive global_tree as (
  select node.user_id, node.parent_id, node.leg, node.sponsor_id,
         array[node.user_id]::uuid[] as path
  from public.network_nodes as node
  where node.user_id = '1d49e94b-381e-41a3-92b8-7441d0f6508e'
  union all
  select child.user_id, child.parent_id, child.leg, child.sponsor_id,
         tree.path || child.user_id
  from global_tree as tree
  join public.network_nodes as child on child.parent_id = tree.user_id
  where not child.user_id = any(tree.path)
), duplicate_slots as (
  select node.parent_id, node.leg
  from public.network_nodes as node
  where node.parent_id is not null
  group by node.parent_id, node.leg
  having count(*) > 1
), sponsor_problems as (
  select node.user_id
  from public.network_nodes as node
  join public.profiles as profile on profile.id = node.user_id
  left join global_tree as tree on tree.user_id = node.user_id
  where node.sponsor_id is distinct from profile.sponsor_id
     or (node.sponsor_id is not null and not node.sponsor_id = any(tree.path))
)
select
  (select count(*) from public.network_nodes) as total_nodes,
  (select count(*) from global_tree) as connected_nodes,
  (select count(*) from public.network_nodes as node where node.parent_id is null) as roots,
  (select count(*) from duplicate_slots) as duplicate_slots,
  (select count(*) from sponsor_problems) as sponsor_problems,
  case
    when (select count(*) from public.network_nodes) = (select count(*) from global_tree)
     and (select count(*) from public.network_nodes as node where node.parent_id is null) = 1
     and not exists (select 1 from duplicate_slots)
     and not exists (select 1 from sponsor_problems)
    then 'GLOBAL_BINARY_HEALTHY'
    else 'REVIEW_REQUIRED'
  end as verification;
