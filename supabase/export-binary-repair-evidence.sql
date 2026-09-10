-- Read-only evidence for a reviewed repair plan. No balances or credentials.
select n.user_id, p.username, n.created_at as node_created_at,
       u.created_at as account_created_at,
       n.sponsor_id, p.sponsor_id as profile_sponsor_id,
       sponsor.username as sponsor_username,
       n.parent_id, parent.username as binary_parent_username, n.leg,
       u.raw_user_meta_data ->> 'preferred_leg' as recorded_preferred_leg
from public.network_nodes n
left join public.profiles p on p.id = n.user_id
left join public.profiles sponsor on sponsor.id = n.sponsor_id
left join public.profiles parent on parent.id = n.parent_id
left join auth.users u on u.id = n.user_id
order by n.created_at, n.user_id;
