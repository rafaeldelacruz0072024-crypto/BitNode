-- BitNode: colocación automática de usuarios referidos en el árbol binario.
-- Requisitos: core-model.sql y commissions.sql ya ejecutados.
-- Coloca en amplitud: primero busca espacios libres en el nivel más cercano.
-- No modifica una posición existente.

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
  v_parent_id uuid;
  v_leg text;
  v_existing public.network_nodes%rowtype;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Users may place only their own node';
  end if;
  if p_user_id is null then raise exception 'User id is required'; end if;
  if p_preferred_leg is not null and p_preferred_leg not in ('left', 'right') then
    raise exception 'Preferred leg must be left or right';
  end if;

  select * into v_existing from public.network_nodes where user_id = p_user_id for update;
  if found then
    return jsonb_build_object('status', 'existing', 'user_id', p_user_id, 'parent_id', v_existing.parent_id, 'leg', v_existing.leg);
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'User profile not found'; end if;
  v_sponsor_id := coalesce(p_sponsor_id, v_profile.sponsor_id);
  if v_profile.sponsor_id is distinct from v_sponsor_id then
    raise exception 'Sponsor does not match the profile sponsor';
  end if;

  -- Sin patrocinador: el primer nodo es una raíz.
  if v_sponsor_id is null then
    insert into public.network_nodes(user_id, sponsor_id, parent_id, leg)
    values (p_user_id, null, null, null)
    on conflict (user_id) do nothing;
    select * into v_existing from public.network_nodes where user_id = p_user_id;
    return jsonb_build_object('status', 'placed', 'user_id', p_user_id, 'parent_id', null, 'leg', null);
  end if;

  -- Un solo colocador por patrocinador evita que dos altas ocupen la misma plaza.
  perform pg_advisory_xact_lock(hashtextextended(v_sponsor_id::text, 0));

  if not exists (select 1 from public.network_nodes where user_id = v_sponsor_id) then
    raise exception 'Sponsor must have a network node before placing a referral';
  end if;

  with recursive tree as (
    select n.user_id, 0 as depth
    from public.network_nodes n
    where n.user_id = v_sponsor_id
    union all
    select child.user_id, tree.depth + 1
    from tree
    join public.network_nodes child on child.parent_id = tree.user_id
    where tree.depth < 100
  ), possible_slots as (
    select tree.user_id as parent_id, slots.leg, tree.depth
    from tree
    cross join (values ('left'::text), ('right'::text)) as slots(leg)
    where p_preferred_leg is null or slots.leg = p_preferred_leg
  )
  select possible_slots.parent_id, possible_slots.leg
  into v_parent_id, v_leg
  from possible_slots
  where not exists (
    select 1 from public.network_nodes occupied
    where occupied.parent_id = possible_slots.parent_id
      and occupied.leg = possible_slots.leg
  )
  order by possible_slots.depth, possible_slots.parent_id, case when possible_slots.leg = 'left' then 0 else 1 end
  limit 1;

  if v_parent_id is null then
    raise exception 'No available binary position within 100 levels';
  end if;

  insert into public.network_nodes(user_id, sponsor_id, parent_id, leg)
  values (p_user_id, v_sponsor_id, v_parent_id, v_leg);

  return jsonb_build_object('status', 'placed', 'user_id', p_user_id, 'sponsor_id', v_sponsor_id, 'parent_id', v_parent_id, 'leg', v_leg);
exception
  when unique_violation then
    select * into v_existing from public.network_nodes where user_id = p_user_id;
    if found then
      return jsonb_build_object('status', 'existing', 'user_id', p_user_id, 'parent_id', v_existing.parent_id, 'leg', v_existing.leg);
    end if;
    raise;
end;
$$;

revoke all on function public.place_network_node(uuid, uuid, text) from public;
revoke all on function public.place_network_node(uuid, uuid, text) from anon;
grant execute on function public.place_network_node(uuid, uuid, text) to authenticated;
grant execute on function public.place_network_node(uuid, uuid, text) to service_role;
