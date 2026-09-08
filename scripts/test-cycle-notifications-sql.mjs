import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const user = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
    grant usage on schema auth to authenticated;
    create table public.contracts(id text primary key, capital numeric);
    create table public.transactions(id text primary key,status text);
    insert into auth.users values ('${user}'),('${other}');
    insert into contracts values ('node',100);
    insert into transactions values ('pending','pending'),('paid','completed');`);
  const base = await readFile(new URL("../supabase/migrations/20260902010833_global_daily_task_cycles.sql", import.meta.url), "utf8");
  await db.exec(base.split("create or replace function public.get_daily_task_cycle()")[0]);
  await db.exec(await readFile(new URL("../supabase/migrations/20260908202833_cycle_reset_notifications.sql", import.meta.url), "utf8"));
  await db.exec(`insert into daily_task_cycles(user_id,cycle_day,completed_tasks,window_started_at)
    values ('${user}',3,array['task'],now()-interval '25 hours');
    insert into contract_cycle_rewards(user_id,contract_id,reward_date,rate,amount,status,transaction_id)
    values ('${user}','node',current_date,.01,1,'pending','pending'),
      ('${user}','node',current_date-1,.01,1,'completed','paid');
    select reset_daily_cycle_for_user('${user}','missed_24h_window');
    select reset_daily_cycle_for_user('${user}','missed_24h_window');`);
  assert.equal((await db.query("select count(*)::int n from user_notifications")).rows[0].n, 1);
  assert.equal((await db.query("select capital::float8 capital from contracts")).rows[0].capital,100);
  assert.deepEqual((await db.query("select id,status from transactions order by id")).rows,
    [{id:"paid",status:"completed"},{id:"pending",status:"reversed"}]);
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}';`);
  assert.equal((await db.query("select * from user_notifications")).rows.length,0);
  assert.equal((await db.query("update user_notifications set read_at=now() returning id")).rows.length,0);
  await db.exec(`set request.jwt.claim.sub='${user}';`);
  assert.equal((await db.query("select * from user_notifications where read_at is null")).rows.length,1);
  await assert.rejects(db.exec("update user_notifications set kind='cycle_reset'"), /permission denied/);
  await db.exec("update user_notifications set read_at=now()");
  assert.equal((await db.query("select * from user_notifications where read_at is null")).rows.length,0);
  console.log("Verified: persistent reset notice, duplicate prevention, own-user read/update only, capital and paid earnings preserved.");
} finally { await db.close(); }
