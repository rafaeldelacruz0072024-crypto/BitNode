begin;
create schema if not exists bitnode_private;
create or replace function bitnode_private.can_manage_marketing()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function bitnode_private.can_manage_marketing() from public, anon;
grant usage on schema bitnode_private to authenticated;
grant execute on function bitnode_private.can_manage_marketing() to authenticated;

create table public.marketing_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  description text not null default '' check(length(description)<=2000),
  category text not null check(category in ('Flyers','Presentaciones','Guías','Videos','Otros')),
  file_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes between 1 and 20971520),
  published boolean not null default true,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.marketing_materials enable row level security;
revoke all on public.marketing_materials from anon, authenticated;
grant select, insert on public.marketing_materials to authenticated;
grant update(published) on public.marketing_materials to authenticated;
create policy marketing_read on public.marketing_materials for select to authenticated
  using(published or bitnode_private.can_manage_marketing());
create policy marketing_create on public.marketing_materials for insert to authenticated
  with check(bitnode_private.can_manage_marketing() and uploaded_by=auth.uid()
    and split_part(file_path,'/',1)=auth.uid()::text);
create policy marketing_publish on public.marketing_materials for update to authenticated
  using(bitnode_private.can_manage_marketing()) with check(bitnode_private.can_manage_marketing());
create index marketing_materials_date_idx on public.marketing_materials(created_at desc);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketing-materials','marketing-materials',false,20971520,
 array['image/jpeg','image/png','image/webp','application/pdf','application/zip','application/x-zip-compressed',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','video/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy marketing_file_upload on storage.objects for insert to authenticated
  with check(bucket_id='marketing-materials' and bitnode_private.can_manage_marketing()
    and split_part(name,'/',1)=auth.uid()::text);
create policy marketing_file_read on storage.objects for select to authenticated
  using(bucket_id='marketing-materials' and (bitnode_private.can_manage_marketing() or exists(
    select 1 from public.marketing_materials m where m.file_path=name and m.published)));
-- Only failed new uploads are removed by the client. Published materials are
-- hidden via metadata, preserving files for recovery and admin traceability.
create policy marketing_file_cleanup on storage.objects for delete to authenticated
  using(bucket_id='marketing-materials' and bitnode_private.can_manage_marketing()
    and split_part(name,'/',1)=auth.uid()::text and not exists(
      select 1 from public.marketing_materials m where m.file_path=name));
notify pgrst,'reload schema';
commit;
