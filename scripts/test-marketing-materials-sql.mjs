import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const admin = '00000000-0000-0000-0000-000000000001';
const user = '00000000-0000-0000-0000-000000000002';
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key); create table profiles(id uuid primary key,role text);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,storage to authenticated; grant execute on function auth.uid() to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security; grant select,insert,delete on storage.objects to authenticated;
    insert into auth.users values('${admin}'),('${user}'); insert into profiles values('${admin}','admin'),('${user}','user');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261003025849_marketing_materials_library.sql',import.meta.url),'utf8'));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${admin}',false);
    insert into storage.objects(bucket_id,name) values('marketing-materials','${admin}/flyer.png');
    insert into marketing_materials(title,category,file_path,file_name,mime_type,size_bytes)
      values('Flyer','Flyers','${admin}/flyer.png','flyer.png','image/png',100);`);
  await db.exec(`select set_config('request.jwt.claim.sub','${user}',false)`);
  assert.equal((await db.query('select * from marketing_materials')).rows.length,1);
  assert.equal((await db.query('select * from storage.objects')).rows.length,1);
  await assert.rejects(db.exec(`insert into storage.objects(bucket_id,name) values('marketing-materials','${user}/bad.png')`),/row-level security/);
  await assert.rejects(db.exec(`insert into marketing_materials(title,category,file_path,file_name,mime_type,size_bytes) values('Bad','Flyers','${user}/bad.png','bad.png','image/png',100)`),/row-level security/);
  await db.exec('update marketing_materials set published=false');
  assert.equal((await db.query('select * from marketing_materials')).rows[0].published,true);
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false); update marketing_materials set published=false;`);
  assert.equal((await db.query('select * from marketing_materials')).rows.length,1);
  await assert.rejects(db.exec(`update marketing_materials set uploaded_by='${user}'`),/permission denied/);
  await db.exec(`select set_config('request.jwt.claim.sub','${user}',false)`);
  assert.equal((await db.query('select * from marketing_materials')).rows.length,0);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from marketing_materials'),/permission denied/);
  console.log('PASS: SQL compilation, admin-only uploads/publication, user reads/download policy, hidden material denial, immutable upload author, anonymous denial. Storage schema mocked; real uploads need live verification.');
} finally { await db.close(); }
