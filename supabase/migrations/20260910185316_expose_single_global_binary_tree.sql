-- Every authenticated member sees the same BitNode binary network. Financial
-- summaries remain user-scoped; this function exposes only usernames and the
-- placement topology rooted at the verified principal account.
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
  if v_requestor_id is null then raise exception 'Authenticated user is required'; end if;
  if p_max_depth < 1 or p_max_depth > 25 then
    raise exception 'Maximum depth must be between 1 and 25';
  end if;
  if not exists (
    select 1 from public.network_nodes
    where user_id = v_root_id and parent_id is null and leg is null
  ) then
    raise exception 'Verified principal binary root was not found';
  end if;

  return query
  with recursive tree as (
    select n.user_id, n.parent_id, n.leg, n.sponsor_id, 0 as depth,
           array[n.user_id]::uuid[] as path
    from public.network_nodes n
    where n.user_id = v_root_id
    union all
    select child.user_id, child.parent_id, child.leg, child.sponsor_id,
           tree.depth + 1, tree.path || child.user_id
    from tree
    join public.network_nodes child on child.parent_id = tree.user_id
    where tree.depth < p_max_depth
      and not child.user_id = any(tree.path)
  )
  select tree.user_id, tree.parent_id, tree.leg, tree.sponsor_id,
         coalesce(profile.username, 'Usuario')::text, tree.depth
  from tree
  left join public.profiles profile on profile.id = tree.user_id
  order by tree.depth, tree.parent_id nulls first,
           case tree.leg when 'left' then 0 else 1 end, tree.user_id;
end;
$$;

revoke all on function public.get_my_network_tree(uuid, integer) from public;
revoke all on function public.get_my_network_tree(uuid, integer) from anon;
grant execute on function public.get_my_network_tree(uuid, integer) to authenticated;
grant execute on function public.get_my_network_tree(uuid, integer) to service_role;

-- Join every remaining binary forest to the principal tree. Moving a secondary
-- root carries its descendants with it and does not alter sponsorship.
lock table public.network_nodes in access exclusive mode;
create schema if not exists binary_repair_private;
revoke all on schema binary_repair_private from public, anon, authenticated;
create table if not exists binary_repair_private.global_tree_merge_backup (
  user_id uuid primary key,
  sponsor_id uuid,
  parent_id uuid,
  leg text,
  saved_at timestamptz not null default now()
);
revoke all on binary_repair_private.global_tree_merge_backup from public, anon, authenticated;
insert into binary_repair_private.global_tree_merge_backup(user_id,sponsor_id,parent_id,leg)
select user_id,sponsor_id,parent_id,leg from public.network_nodes
on conflict (user_id) do nothing;

do $$
declare
  v_root_id constant uuid := '1d49e94b-381e-41a3-92b8-7441d0f6508e';
  v_secondary_root record;
  v_parent_id uuid;
  v_leg text;
begin
  if not exists (
    select 1 from public.network_nodes
    where user_id=v_root_id and parent_id is null and leg is null
  ) then
    raise exception 'Verified principal binary root was not found';
  end if;

  for v_secondary_root in
    select n.user_id from public.network_nodes n
    where n.parent_id is null and n.user_id<>v_root_id
    order by n.created_at,n.user_id
  loop
    v_parent_id := null;
    v_leg := null;
    with recursive tree as (
      select n.user_id,0 as depth,array[]::integer[] as route,array[n.user_id] as path
      from public.network_nodes n where n.user_id=v_root_id
      union all
      select child.user_id,tree.depth+1,
             tree.route || case child.leg when 'left' then 0 else 1 end,
             tree.path || child.user_id
      from tree join public.network_nodes child on child.parent_id=tree.user_id
      where not child.user_id=any(tree.path)
    )
    select tree.user_id,slot.leg into v_parent_id,v_leg
    from tree
    cross join (values ('left'::text,0),('right'::text,1)) slot(leg,sort_order)
    where not exists (
      select 1 from public.network_nodes occupied
      where occupied.parent_id=tree.user_id and occupied.leg=slot.leg
    )
    order by tree.depth,tree.route,slot.sort_order
    limit 1;

    if v_parent_id is null then raise exception 'No free global binary position'; end if;
    update public.network_nodes
    set parent_id=v_parent_id,leg=v_leg
    where user_id=v_secondary_root.user_id;
  end loop;

  if (select count(*) from public.network_nodes where parent_id is null)<>1 then
    raise exception 'Global binary merge did not produce exactly one root';
  end if;
end;
$$;
