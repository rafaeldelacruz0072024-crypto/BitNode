-- A preferred leg selects the sponsor's main branch. Once that branch exists,
-- descendants fill breadth-first using both child positions. The previous
-- implementation restricted every descendant to the same leg, creating a
-- diagonal chain instead of a binary tree.
create or replace function public.place_network_node(
  p_user_id uuid,
  p_sponsor_id uuid default null,
  p_preferred_leg text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_sponsor_id uuid;
  v_branch_root uuid;
  v_parent_id uuid;
  v_leg text;
  v_existing public.network_nodes%rowtype;
  v_had_existing boolean := false;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Users may place only their own node';
  end if;
  if p_user_id is null then raise exception 'User id is required'; end if;
  if p_preferred_leg is not null and p_preferred_leg not in ('left', 'right') then
    raise exception 'Preferred leg must be left or right';
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'User profile not found'; end if;
  v_sponsor_id := coalesce(p_sponsor_id, v_profile.sponsor_id);
  if v_profile.sponsor_id is distinct from v_sponsor_id then
    raise exception 'Sponsor does not match the profile sponsor';
  end if;

  select * into v_existing from public.network_nodes where user_id = p_user_id for update;
  v_had_existing := found;
  if v_had_existing and not (
    v_existing.sponsor_id is null and v_existing.parent_id is null and
    v_existing.leg is null and v_sponsor_id is not null and
    not exists (select 1 from public.network_nodes where parent_id = p_user_id)
  ) then
    return jsonb_build_object('status', 'existing', 'user_id', p_user_id,
      'sponsor_id', v_existing.sponsor_id, 'parent_id', v_existing.parent_id,
      'leg', v_existing.leg);
  end if;

  if v_sponsor_id is null then
    insert into public.network_nodes(user_id, sponsor_id, parent_id, leg)
    values (p_user_id, null, null, null) on conflict (user_id) do nothing;
    return jsonb_build_object('status', 'placed', 'user_id', p_user_id,
      'sponsor_id', null, 'parent_id', null, 'leg', null);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_sponsor_id::text, 0));
  if not exists (select 1 from public.network_nodes where user_id = v_sponsor_id) then
    raise exception 'Sponsor must have a network node before placing a referral';
  end if;

  -- The first person requested for a sponsor leg occupies that exact slot.
  if p_preferred_leg is not null then
    select n.user_id into v_branch_root
    from public.network_nodes n
    where n.parent_id = v_sponsor_id and n.leg = p_preferred_leg;
    if v_branch_root is null then
      v_parent_id := v_sponsor_id;
      v_leg := p_preferred_leg;
    end if;
  else
    v_branch_root := v_sponsor_id;
  end if;

  -- After the branch root, fill every parent left then right, level by level.
  if v_parent_id is null then
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

  if v_parent_id is null then raise exception 'No available binary position within 100 levels'; end if;

  if v_had_existing then
    update public.network_nodes
    set sponsor_id = v_sponsor_id, parent_id = v_parent_id, leg = v_leg
    where user_id = p_user_id;
  else
    insert into public.network_nodes(user_id, sponsor_id, parent_id, leg)
    values (p_user_id, v_sponsor_id, v_parent_id, v_leg);
  end if;

  return jsonb_build_object('status', 'placed', 'user_id', p_user_id,
    'sponsor_id', v_sponsor_id, 'parent_id', v_parent_id, 'leg', v_leg);
end;
$$;

revoke all on function public.place_network_node(uuid, uuid, text) from public;
revoke all on function public.place_network_node(uuid, uuid, text) from anon;
grant execute on function public.place_network_node(uuid, uuid, text) to authenticated;
grant execute on function public.place_network_node(uuid, uuid, text) to service_role;

-- Repair the topology already produced by the old diagonal placement rule.
-- Keep each independent root and every sponsor relationship, but assign binary
-- parents in registration order: root, left, right, then the next level.
lock table public.network_nodes in access exclusive mode;

create temporary table binary_repair_positions on commit drop as
with recursive rooted as (
  select n.user_id, n.user_id as root_id
  from public.network_nodes n
  where n.parent_id is null
  union
  select child.user_id, rooted.root_id
  from rooted
  join public.network_nodes child on child.parent_id = rooted.user_id
), ordered as (
  select n.user_id, rooted.root_id,
         row_number() over (
           partition by rooted.root_id
           order by case when n.user_id = rooted.root_id then 0 else 1 end,
                    n.created_at, n.user_id
         )::bigint as position
  from rooted
  join public.network_nodes n on n.user_id = rooted.user_id
)
select ordered.user_id,
       parent.user_id as parent_id,
       case
         when ordered.position = 1 then null
         when mod(ordered.position, 2) = 0 then 'left'::text
         else 'right'::text
       end as leg
from ordered
left join ordered parent
  on parent.root_id = ordered.root_id
 and parent.position = floor(ordered.position / 2.0)::bigint;

alter table public.network_nodes
  drop constraint if exists network_nodes_parent_leg_unique;

update public.network_nodes node
set parent_id = desired.parent_id,
    leg = desired.leg
from binary_repair_positions desired
where desired.user_id = node.user_id
  and (node.parent_id is distinct from desired.parent_id
    or node.leg is distinct from desired.leg);

alter table public.network_nodes
  add constraint network_nodes_parent_leg_unique unique (parent_id, leg);
