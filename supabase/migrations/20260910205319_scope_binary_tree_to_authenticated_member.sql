-- Keep one connected global binary network in storage, while exposing only the
-- authenticated member's own subtree in the dashboard.
begin;

create or replace function public.get_my_network_tree(
  p_user_id uuid default null,
  p_max_depth integer default 25
)
returns table(
  user_id uuid,
  parent_id uuid,
  leg text,
  sponsor_id uuid,
  username text,
  depth integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  v_caller_id uuid := auth.uid();
  v_view_root_id uuid;
begin
  if v_role = 'service_role' then
    v_view_root_id := coalesce(p_user_id, v_caller_id);
  else
    if v_caller_id is null then raise exception 'Authenticated user is required'; end if;
    if p_user_id is not null and p_user_id is distinct from v_caller_id then
      raise exception 'Users may request only their own binary subtree';
    end if;
    v_view_root_id := v_caller_id;
  end if;

  if v_view_root_id is null then raise exception 'A binary subtree owner is required'; end if;
  if p_max_depth < 1 or p_max_depth > 25 then
    raise exception 'Maximum depth must be between 1 and 25';
  end if;
  if not exists (
    select 1 from public.network_nodes as member_node
    where member_node.user_id = v_view_root_id
  ) then
    raise exception 'The authenticated user has no binary position';
  end if;

  return query
  with recursive tree as (
    select
      member_node.user_id,
      member_node.parent_id,
      member_node.leg,
      member_node.sponsor_id,
      0 as tree_depth,
      array[member_node.user_id]::uuid[] as path
    from public.network_nodes as member_node
    where member_node.user_id = v_view_root_id

    union all

    select
      child.user_id,
      child.parent_id,
      child.leg,
      child.sponsor_id,
      tree.tree_depth + 1,
      tree.path || child.user_id
    from tree
    join public.network_nodes as child on child.parent_id = tree.user_id
    where tree.tree_depth < p_max_depth
      and not child.user_id = any(tree.path)
  )
  select
    tree.user_id,
    case when tree.tree_depth = 0 then null else tree.parent_id end,
    case when tree.tree_depth = 0 then null else tree.leg end,
    tree.sponsor_id,
    coalesce(profile.username, 'Usuario')::text,
    tree.tree_depth
  from tree
  left join public.profiles as profile on profile.id = tree.user_id
  order by
    tree.tree_depth,
    tree.parent_id nulls first,
    case tree.leg when 'left' then 0 else 1 end,
    tree.user_id;
end;
$$;

revoke all on function public.get_my_network_tree(uuid, integer) from public;
revoke all on function public.get_my_network_tree(uuid, integer) from anon;
grant execute on function public.get_my_network_tree(uuid, integer) to authenticated;
grant execute on function public.get_my_network_tree(uuid, integer) to service_role;

-- SQL Editor verification: the principal sees the complete connected network,
-- while a leaf account sees only itself.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

with leaf as (
  select node.user_id
  from public.network_nodes as node
  where not exists (
    select 1 from public.network_nodes as child where child.parent_id = node.user_id
  )
  order by node.created_at, node.user_id
  limit 1
), principal_view as (
  select * from public.get_my_network_tree(
    '1d49e94b-381e-41a3-92b8-7441d0f6508e'::uuid, 25
  )
), leaf_view as (
  select subtree.*
  from leaf
  cross join lateral public.get_my_network_tree(leaf.user_id, 25) as subtree
)
select
  (select count(*) from principal_view) as principal_visible_nodes,
  (select count(*) from public.network_nodes) as total_nodes,
  (select user_id from leaf) as tested_leaf_user_id,
  (select count(*) from leaf_view) as leaf_visible_nodes,
  case
    when (select count(*) from principal_view) = (select count(*) from public.network_nodes)
     and (select count(*) from leaf_view) = 1
    then 'MEMBER_SUBTREE_VISIBILITY_OK'
    else 'REVIEW_REQUIRED'
  end as verification;

commit;
