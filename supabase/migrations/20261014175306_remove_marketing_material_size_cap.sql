begin;
-- Remove the application-specific cap, not the provider's global limit.
-- Admin-only uploads, allowed MIME types, RLS and private files are unchanged.
alter table public.marketing_materials
  drop constraint if exists marketing_materials_size_bytes_check;
alter table public.marketing_materials
  add constraint marketing_materials_size_bytes_check check (size_bytes > 0);

do $$
begin
  update storage.buckets set file_size_limit = null where id = 'marketing-materials';
  if not found then raise exception 'Marketing bucket not found; apply the original marketing migration first.'; end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
