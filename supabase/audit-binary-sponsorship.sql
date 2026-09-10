-- Read-only audit. Run in the BitNode SQL editor as an administrator.
-- Metadata is historical evidence only: users can edit it. It is not authority
-- for moving nodes. Verify discrepancies against registration logs/backups.
with recursive ancestry as (
  select n.user_id as subject_id, n.user_id as ancestor_id,
         n.parent_id, n.leg, array[n.user_id] as path, false as cycle
  from public.network_nodes n
  union all
  select a.subject_id, p.user_id, p.parent_id, p.leg,
         a.path || p.user_id, p.user_id = any(a.path)
  from ancestry a
  join public.network_nodes p on p.user_id = a.parent_id
  where not a.cycle
), checks as (
  select n.user_id, profile.username,
         sponsor.username as sponsor_username,
         parent.username as binary_parent_username,
         n.parent_id, n.leg,
         u.raw_user_meta_data ->> 'preferred_leg' as recorded_preferred_leg,
         (select a.leg from ancestry a
          where a.subject_id = n.user_id and a.parent_id = n.sponsor_id
            and not a.cycle limit 1) as actual_sponsor_branch,
         array_remove(array[
           case when n.sponsor_id is distinct from profile.sponsor_id
             then 'SPONSOR_DIFFERS_FROM_PROFILE' end,
           case when n.sponsor_id is not null and not exists (
             select 1 from ancestry a where a.subject_id = n.user_id
               and a.ancestor_id = n.sponsor_id and a.ancestor_id <> n.user_id
           ) then 'OUTSIDE_SPONSOR_SUBTREE' end,
           case when n.parent_id is not null and parent_node.user_id is null
             then 'MISSING_BINARY_PARENT' end,
           case when exists (select 1 from ancestry a
             where a.subject_id = n.user_id and a.cycle)
             then 'BINARY_CYCLE' end,
           case when n.parent_id is not null and exists (
             select 1 from public.network_nodes other
             where other.parent_id = n.parent_id and other.leg = n.leg
               and other.user_id <> n.user_id
           ) then 'DUPLICATE_POSITION' end,
           case when (n.parent_id is null) <> (n.leg is null)
             or n.leg not in ('left', 'right') then 'INVALID_POSITION' end
         ], null) as issues
  from public.network_nodes n
  left join public.profiles profile on profile.id = n.user_id
  left join public.profiles sponsor on sponsor.id = n.sponsor_id
  left join public.profiles parent on parent.id = n.parent_id
  left join public.network_nodes parent_node on parent_node.user_id = n.parent_id
  left join auth.users u on u.id = n.user_id
)
select *, case
  when cardinality(issues) > 0 then 'REVIEW_REQUIRED'
  when recorded_preferred_leg in ('left', 'right')
    and actual_sponsor_branch is distinct from recorded_preferred_leg
    then 'BRANCH_DIFFERS_FROM_REGISTRATION_METADATA'
  else 'STRUCTURE_OK_VERIFY_HISTORICAL_ORDER'
end as audit_status
from checks
order by cardinality(issues) desc, username, user_id;
