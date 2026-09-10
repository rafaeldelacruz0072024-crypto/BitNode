-- Authorized exception: move these ten users under rootcode, five per branch.
-- Sponsors remain unchanged; this intentionally does NOT restore sponsor ancestry.
-- Execute the whole script in BitNode SQL Editor. Any failed check rolls back.
begin;
lock table public.network_nodes in access exclusive mode;
create schema if not exists binary_repair_private;
revoke all on schema binary_repair_private from public, anon, authenticated;
create table if not exists binary_repair_private.rootcode_five_each_backup (
  user_id uuid primary key, sponsor_id uuid, parent_id uuid, leg text,
  saved_at timestamptz not null default now()
);
revoke all on binary_repair_private.rootcode_five_each_backup from public, anon, authenticated;
do $$
declare
  root_id uuid := 'a2b4c624-0e6e-4be9-9bb0-58a719c7e34d';
  target_ids uuid[] := array[
    '99331595-c002-4a2b-9087-01fd22bf292a'::uuid,'1254e24c-227c-4f73-a390-26238ccd4ec8'::uuid,
    'efbe30e4-46cf-44df-bf47-ea27d80f4094'::uuid,'8e32a176-6f59-4f2a-ad8e-51d388153b76'::uuid,
    '25f31971-ae09-416f-8256-cef4e51e0a06'::uuid,'c3f011f8-d572-4839-882e-8fdca9d06529'::uuid,
    'aff0b2e1-e589-46b4-a432-dfd67320351e'::uuid,'80dbfaba-12f2-4097-bf9e-54fcf9d116d2'::uuid,
    '64e91633-b59b-4ec9-8a1b-5d75f8531cb2'::uuid,'d360b1b5-64da-403d-94c3-b65fb15170f6'::uuid
  ];
  member record;
  side text;
  branch_id uuid;
  destination uuid;
  destination_leg text;
  matched integer;
begin
  if not exists (select 1 from public.profiles where id=root_id and username='rootcode')
    or not exists (select 1 from public.network_nodes where user_id=root_id and parent_id is null)
    then raise exception 'Expected BitNode rootcode root not found'; end if;
  if (select count(*) from public.network_nodes where user_id = any(target_ids)) <> 10
    then raise exception 'Expected exactly ten users'; end if;
  if exists (select 1 from binary_repair_private.rootcode_five_each_backup)
    then raise exception 'Repair already executed: inspect saved backup before any rerun'; end if;

  insert into binary_repair_private.rootcode_five_each_backup(user_id,sponsor_id,parent_id,leg)
    select user_id,sponsor_id,parent_id,leg from public.network_nodes;

  -- Detach only the selected users. Unselected children keep their parent.
  update public.network_nodes set parent_id=null, leg=null
    where user_id = any(target_ids);
  for member in
    select n.*, row_number() over (order by u.created_at, n.created_at, n.user_id)::integer as sequence
    from public.network_nodes n join auth.users u on u.id=n.user_id
    where n.user_id=any(target_ids)
    order by sequence
  loop
    side := case when member.sequence <= 5 then 'left' else 'right' end;
    destination := null;
    destination_leg := null;
    select user_id into branch_id from public.network_nodes
      where parent_id=root_id and leg=side;
    if branch_id is null then
      destination := root_id;
      destination_leg := side;
    else
      with recursive tree as (
        select n.user_id, 0 as depth, array[]::integer[] as route, array[n.user_id] as visited
        from public.network_nodes n where n.user_id=branch_id
        union all
        select n.user_id, t.depth+1, t.route || case n.leg when 'left' then 0 else 1 end,
               t.visited || n.user_id
        from tree t join public.network_nodes n on n.parent_id=t.user_id
        where not n.user_id=any(t.visited)
      )
      select t.user_id, slot.leg into destination,destination_leg
      from tree t cross join (values ('left'::text,0),('right'::text,1)) slot(leg,sort)
      where not exists (select 1 from public.network_nodes n where n.parent_id=t.user_id and n.leg=slot.leg)
      order by t.depth,t.route,slot.sort limit 1;
    end if;
    if destination is null then raise exception 'No free position'; end if;
    update public.network_nodes set parent_id=destination,leg=destination_leg
      where user_id=member.user_id;
  end loop;

  with recursive tree as (
    select user_id,leg as branch,array[user_id] as path from public.network_nodes where parent_id=root_id
    union all
    select n.user_id,t.branch,t.path || n.user_id from tree t
      join public.network_nodes n on n.parent_id=t.user_id where not n.user_id=any(t.path)
  )
  select count(*) into matched from tree t join (
    select n.user_id, row_number() over (order by u.created_at,n.created_at,n.user_id) as sequence
    from public.network_nodes n join auth.users u on u.id=n.user_id
    where n.user_id=any(target_ids)
  ) m using(user_id)
    where t.branch=case when m.sequence<=5 then 'left' else 'right' end;
  if matched<>10 then raise exception 'Five-per-branch verification failed'; end if;
  if exists (
    select 1 from public.network_nodes n
    join binary_repair_private.rootcode_five_each_backup b using(user_id)
    where n.sponsor_id is distinct from b.sponsor_id
       or (not n.user_id=any(target_ids)
           and (n.parent_id is distinct from b.parent_id or n.leg is distinct from b.leg))
  ) then raise exception 'Sponsor or unselected position changed'; end if;
end;
$$;
with selected as (
  select n.user_id,row_number() over (order by u.created_at,n.created_at,n.user_id) as sequence
  from public.network_nodes n join auth.users u on u.id=n.user_id
  where n.user_id in (
    '99331595-c002-4a2b-9087-01fd22bf292a','1254e24c-227c-4f73-a390-26238ccd4ec8',
    'efbe30e4-46cf-44df-bf47-ea27d80f4094','8e32a176-6f59-4f2a-ad8e-51d388153b76',
    '25f31971-ae09-416f-8256-cef4e51e0a06','c3f011f8-d572-4839-882e-8fdca9d06529',
    'aff0b2e1-e589-46b4-a432-dfd67320351e','80dbfaba-12f2-4097-bf9e-54fcf9d116d2',
    '64e91633-b59b-4ec9-8a1b-5d75f8531cb2','d360b1b5-64da-403d-94c3-b65fb15170f6'
  )
)
select m.sequence,p.username,
  case when m.sequence<=5 then 'left' else 'right' end as rootcode_branch,
  b.parent_id as previous_parent_id,n.parent_id as new_parent_id,n.leg,
  n.sponsor_id as unchanged_sponsor_id
from selected m join public.network_nodes n using(user_id)
join binary_repair_private.rootcode_five_each_backup b using(user_id)
left join public.profiles p on p.id=n.user_id order by m.sequence;
commit;
