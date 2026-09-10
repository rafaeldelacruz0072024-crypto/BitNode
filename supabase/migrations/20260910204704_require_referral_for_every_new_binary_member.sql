-- Every new member must enter through a valid sponsor referral. Existing
-- profiles remain readable without replaying referral data during login.
begin;

create or replace function public.create_profile(
  p_username text,
  p_referral_code text default null,
  p_sponsor_referral_code text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_sponsor_id uuid;
  v_profile_exists boolean := false;
  v_referral_code text := lower(trim(coalesce(nullif(p_referral_code, ''), p_username)));
begin
  if auth.uid() is null then raise exception 'Authenticated user is required'; end if;
  if nullif(trim(p_username), '') is null then raise exception 'Username is required'; end if;

  select * into v_profile
  from public.profiles as existing_profile
  where existing_profile.id = auth.uid()
  for update;
  v_profile_exists := found;

  if nullif(trim(p_sponsor_referral_code), '') is not null then
    select sponsor_profile.id into v_sponsor_id
    from public.profiles as sponsor_profile
    where lower(sponsor_profile.referral_code) = lower(trim(p_sponsor_referral_code));
    if v_sponsor_id is null then raise exception 'Sponsor referral code not found'; end if;
    if v_sponsor_id = auth.uid() then raise exception 'A user cannot sponsor itself'; end if;
  end if;

  if v_profile_exists then
    if v_sponsor_id is not null then
      if v_profile.sponsor_id is null then
        update public.profiles as profile
        set sponsor_id = v_sponsor_id
        where profile.id = auth.uid()
        returning * into v_profile;
      elsif v_profile.sponsor_id is distinct from v_sponsor_id then
        raise exception 'Existing sponsor cannot be changed';
      end if;
    end if;
    return v_profile;
  end if;

  if v_sponsor_id is null then
    raise exception 'A valid sponsor referral link is required to create an account';
  end if;

  insert into public.profiles(id, username, referral_code, sponsor_id)
  values (auth.uid(), trim(p_username), v_referral_code, v_sponsor_id)
  returning * into v_profile;
  return v_profile;
end;
$$;

revoke all on function public.create_profile(text, text, text) from public;
revoke all on function public.create_profile(text, text, text) from anon;
grant execute on function public.create_profile(text, text, text) to authenticated;

select
  'REFERRAL_REQUIRED_FOR_NEW_USERS' as verification,
  count(*) filter (where profile.sponsor_id is null) as existing_profiles_without_sponsor
from public.profiles as profile;

commit;
