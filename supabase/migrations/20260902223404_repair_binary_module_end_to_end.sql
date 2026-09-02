-- Returns only the authenticated user's binary subtree. This keeps the API
-- owner-scoped while allowing the frontend to render every occupied level.
drop function if exists public.get_my_network_tree(integer);

create or replace function public.get_my_network_tree(
  p_user_id uuid default null,
  p_max_depth integer default 12
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
  v_user_id uuid := auth.uid();
begin
  if v_role = 'service_role' then
    v_user_id := coalesce(p_user_id, v_user_id);
  elsif p_user_id is not null and p_user_id is distinct from v_user_id then
    raise exception 'Users may read only their own network tree';
  end if;
  if v_user_id is null then raise exception 'Authenticated user is required'; end if;
  if p_max_depth < 1 or p_max_depth > 25 then
    raise exception 'Maximum depth must be between 1 and 25';
  end if;

  return query
  with recursive tree as (
    select n.user_id, n.parent_id, n.leg, n.sponsor_id, 0 as depth,
           array[n.user_id]::uuid[] as path
    from public.network_nodes n
    where n.user_id = v_user_id
    union all
    select child.user_id, child.parent_id, child.leg, child.sponsor_id,
           tree.depth + 1, tree.path || child.user_id
    from tree
    join public.network_nodes child on child.parent_id = tree.user_id
    where tree.depth < p_max_depth
      and not child.user_id = any(tree.path)
  )
  select tree.user_id, tree.parent_id, tree.leg, tree.sponsor_id,
         coalesce(p.username, 'Usuario')::text, tree.depth
  from tree
  join public.profiles p on p.id = tree.user_id
  order by tree.depth, tree.parent_id nulls first, tree.leg;
end;
$$;

revoke all on function public.get_my_network_tree(uuid, integer) from public;
revoke all on function public.get_my_network_tree(uuid, integer) from anon;
grant execute on function public.get_my_network_tree(uuid, integer) to authenticated;
grant execute on function public.get_my_network_tree(uuid, integer) to service_role;

-- Install the 8% formula explicitly. Avoid textual mutation of an older
-- function definition and keep the ledger metadata consistent with the rate.
create or replace function public.process_contract_commissions(
  p_source_event_id text,
  p_contract_id text,
  p_user_id uuid,
  p_amount numeric,
  p_event_type text default 'contract_confirmed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.network_nodes%rowtype;
  v_parent_node public.network_nodes%rowtype;
  v_event_inserted integer;
  v_current uuid := p_user_id;
  v_step integer := 0;
  v_direct numeric := 0;
  v_binary numeric := 0;
  v_commission numeric;
  v_left numeric;
  v_right numeric;
  v_old_matched numeric;
  v_new_matched numeric;
  v_delta numeric;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  ) <> 'service_role' then
    raise exception 'Commission processing is restricted to service_role';
  end if;
  if nullif(trim(p_source_event_id), '') is null then raise exception 'Source event id is required'; end if;
  if nullif(trim(p_contract_id), '') is null then raise exception 'Contract id is required'; end if;
  if p_user_id is null then raise exception 'User id is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_event_type <> 'contract_confirmed' then raise exception 'Only contract_confirmed events are supported'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  insert into public.commission_events(source_event_id, contract_id, user_id, amount, event_type)
  values (trim(p_source_event_id), trim(p_contract_id), p_user_id, p_amount, 'contract_confirmed')
  on conflict (source_event_id) do nothing;
  get diagnostics v_event_inserted = row_count;

  if v_event_inserted = 0 then
    return jsonb_build_object('status', 'duplicate', 'source_event_id', p_source_event_id, 'direct', 0, 'binary', 0);
  end if;

  select * into v_node from public.network_nodes where user_id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'processed', 'source_event_id', p_source_event_id,
      'direct', 0, 'binary', 0, 'reason', 'user has no network node');
  end if;

  if v_node.sponsor_id is not null then
    v_commission := round(p_amount * 0.10, 8);
    insert into public.commission_ledger(
      beneficiary_id, source_user_id, source_event_id,
      commission_type, amount, rate, leg, status, metadata
    ) values (
      v_node.sponsor_id, p_user_id, p_source_event_id,
      'direct', v_commission, 0.10, '', 'credited',
      jsonb_build_object('contract_id', p_contract_id, 'formula', 'amount * 10%')
    ) on conflict (source_event_id, commission_type, beneficiary_id, leg) do nothing;
    if found then v_direct := v_commission; end if;
  end if;

  while v_current is not null and v_step < 100 loop
    v_step := v_step + 1;
    select * into v_node from public.network_nodes where user_id = v_current;
    exit when not found or v_node.parent_id is null or v_node.leg is null;

    select * into v_parent_node
    from public.network_nodes where user_id = v_node.parent_id for update;
    exit when not found;
    v_current := v_parent_node.user_id;

    insert into public.network_volume(user_id, leg, volume, matched_volume)
    values (v_current, v_node.leg, p_amount, 0)
    on conflict (user_id, leg) do update
      set volume = public.network_volume.volume + excluded.volume,
          updated_at = now();

    perform 1 from public.network_volume
    where user_id = v_current and leg in ('left', 'right') for update;

    select coalesce(sum(volume) filter (where leg = 'left'), 0),
           coalesce(sum(volume) filter (where leg = 'right'), 0),
           coalesce(max(matched_volume), 0)
    into v_left, v_right, v_old_matched
    from public.network_volume where user_id = v_current;

    v_new_matched := least(v_left, v_right);
    v_delta := greatest(v_new_matched - v_old_matched, 0);
    if v_delta > 0 then
      v_commission := round(v_delta * 0.08, 8);
      insert into public.commission_ledger(
        beneficiary_id, source_user_id, source_event_id,
        commission_type, amount, rate, leg, status, metadata
      ) values (
        v_current, p_user_id, p_source_event_id,
        'binary', v_commission, 0.08, v_node.leg, 'credited',
        jsonb_build_object(
          'contract_id', p_contract_id,
          'formula', 'new_matched_volume * 8%',
          'matched_volume', v_delta,
          'left_volume', v_left,
          'right_volume', v_right
        )
      ) on conflict (source_event_id, commission_type, beneficiary_id, leg) do nothing;
      if found then v_binary := v_binary + v_commission; end if;
    end if;

    update public.network_volume
    set matched_volume = v_new_matched, updated_at = now()
    where user_id = v_current and leg in ('left', 'right');
  end loop;

  return jsonb_build_object('status', 'processed', 'source_event_id', p_source_event_id,
    'direct', v_direct, 'binary', v_binary, 'levels_processed', v_step);
end;
$$;

revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from public;
revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from anon;
revoke all on function public.process_contract_commissions(text, text, uuid, numeric, text) from authenticated;
grant execute on function public.process_contract_commissions(text, text, uuid, numeric, text) to service_role;
