begin;
create or replace function bitnode_private.has_active_sara_node(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.contracts c join public.plans p on p.id=c.plan_id
    where c.user_id=p_user_id and c.status='active' and p.active
      and (p.duration_days=21 or p.node_version=2)
  );
$$;
revoke all on function bitnode_private.has_active_sara_node(uuid) from public,anon,authenticated;
commit;
