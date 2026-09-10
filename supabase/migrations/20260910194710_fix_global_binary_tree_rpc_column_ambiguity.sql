-- Fix runtime ambiguity between RETURNS TABLE output variables and columns in
-- network_nodes. This restores the global tree for every authenticated user.
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
  v_requestor_id uuid := auth.uid();
  v_root_id constant uuid := '1d49e94b-381e-41a3-92b8-7441d0f6508e';
begin
  if v_role = 'service_role' then
    v_requestor_id := coalesce(p_user_id, v_requestor_id);
  elsif p_user_id is not null and p_user_id is distinct from v_requestor_id then
    raise exception 'Users may request the global tree only for their own session';
  end if;

  if v_requestor_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if p_max_depth < 1 or p_max_depth > 25 then
    raise exception 'Maximum depth must be between 1 and 25';
  end if;

  if not exists (
    select 1
    from public.network_nodes as root_node
    where root_node.user_id = v_root_id
      and root_node.parent_id is null
      and root_node.leg is null
  ) then
    raise exception 'Verified principal binary root was not found';
  end if;

  return query
  with recursive tree as (
    select
      root_node.user_id,
      root_node.parent_id,
      root_node.leg,
      root_node.sponsor_id,
      0 as tree_depth,
      array[root_node.user_id]::uuid[] as path
    from public.network_nodes as root_node
    where root_node.user_id = v_root_id

    union all

    select
      child.user_id,
      child.parent_id,
      child.leg,
      child.sponsor_id,
      tree.tree_depth + 1,
      tree.path || child.user_id
    from tree
    join public.network_nodes as child
      on child.parent_id = tree.user_id
    where tree.tree_depth < p_max_depth
      and not child.user_id = any(tree.path)
  )
  select
    tree.user_id,
    tree.parent_id,
    tree.leg,
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

-- SQL Editor verification uses service-role semantics only inside this
-- transaction and returns the expected node count and root.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

with loaded_tree as (
  select *
  from public.get_my_network_tree(
    '1d49e94b-381e-41a3-92b8-7441d0f6508e'::uuid,
    25
  )
)
select
  count(*) as visible_nodes,
  count(*) filter (where loaded_tree.parent_id is null) as visible_roots,
  max(loaded_tree.username) filter (where loaded_tree.parent_id is null) as root_username,
  case
    when count(*) = (select count(*) from public.network_nodes)
     and count(*) filter (where loaded_tree.parent_id is null) = 1
    then 'GLOBAL_TREE_RPC_OK'
    else 'REVIEW_REQUIRED'
  end as verification
from loaded_tree;

commit;
