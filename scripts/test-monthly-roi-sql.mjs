// Isolated PostgreSQL verification. Pass an installed @electric-sql/pglite entrypoint.
// node scripts/test-monthly-roi-sql.mjs /path/to/pglite/dist/index.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const admin = "00000000-0000-0000-0000-000000000001";
const member = "00000000-0000-0000-0000-000000000002";
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create table public.profiles(id uuid primary key, role text);
    insert into auth.users values ('${admin}', 'gentecash@gmail.com'), ('${member}', 'member@example.test');
    insert into public.profiles values ('${admin}', 'admin'), ('${member}', 'user');
    create function public.complete_daily_tasks(p_task_key text) returns jsonb
    language plpgsql security definer as $$
    declare v_contract record; v_rate numeric(8,6);
    begin
      for v_contract in select 7 as duration_days, 0.01::numeric as rate_min, 0.01::numeric as rate_max loop
      v_rate := round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6);
      return jsonb_build_object('rate', v_rate);
      end loop;
      return jsonb_build_object('paused', true);
    end; $$;
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/20260906214156_monthly_node_roi_controls.sql", import.meta.url), "utf8"));
  const rate = async (duration, day) => (await db.query("select bitnode_private.monthly_daily_rate($1,$2)::float8 as rate", [duration, day])).rows[0].rate;
  const save = (month, rates, version, actor = admin) => db.query(
    "select public.save_monthly_node_roi($1,$2::jsonb,$3,$4)", [month, JSON.stringify(rates), version, actor]
  );
  const rates = { daily: 22, seven: 44, fourteen: 66, twentyOne: 88 };
  assert.equal(await rate(7, "2026-09-07"), null);
  await save("2026-09-01", rates, 0);
  assert.equal(await rate(null, "2026-09-07"), 0.01);
  assert.equal(await rate(7, "2026-09-07"), 0.02);
  assert.equal(await rate(14, "2026-09-07"), 0.03);
  assert.equal(await rate(21, "2026-09-07"), 0.04);
  assert.equal(await rate(30, "2026-09-07"), null);
  assert.equal(await rate(7, "2026-10-01"), null);
  await assert.rejects(save("2026-09-01", rates, 0), /changed/);
  await assert.rejects(save("2026-09-01", rates, 1, member), /Administrator/);
  for (const bad of [{ ...rates, daily: -1 }, { ...rates, daily: 1001 }, { daily: 1 }, { ...rates, daily: "22" }, { ...rates, daily: 0.001 }]) {
    await assert.rejects(save("2026-09-01", bad, 1), /Invalid/);
  }
  await save("2026-09-01", { ...rates, daily: 0 }, 1);
  assert.equal(await rate(null, "2026-09-07"), 0);
  const history = (await db.query("select version, rates from public.monthly_node_roi_history order by version")).rows;
  assert.equal(history.length, 2);
  assert.equal(history[0].rates.daily, 22);
  assert.equal(history[1].rates.daily, 0);
  await save("2026-07-01", { ...rates, daily: 23 }, 0);
  assert.equal(await rate(null, "2026-07-01"), 0.01);
  const permissions = (await db.query(`select
    has_table_privilege('authenticated','public.monthly_node_roi','SELECT') as can_read,
    has_function_privilege('authenticated','public.save_monthly_node_roi(date,jsonb,integer,uuid)','EXECUTE') as can_save,
    has_function_privilege('service_role','public.save_monthly_node_roi(date,jsonb,integer,uuid)','EXECUTE') as server_can_save`)).rows[0];
  assert.deepEqual(permissions, { can_read: false, can_save: false, server_can_save: true });
  await db.exec("set role service_role");
  await save("2026-11-01", rates, 0);
  await db.exec("reset role");
  const definition = (await db.query("select pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure) as body")).rows[0].body;
  assert.match(definition, /monthly_daily_rate/);
  const currentMonth = (await db.query("select to_char(current_date,'YYYY-MM-01') as month_key")).rows[0].month_key;
  const currentVersion = (await db.query("select version from monthly_node_roi where month=$1", [currentMonth])).rows[0]?.version || 0;
  await save(currentMonth, { ...rates, seven: 0 }, currentVersion);
  assert.deepEqual((await db.query("select complete_daily_tasks('test') result")).rows[0].result, { paused: true });
  console.log("SQL verified: migration, four plan rates, actual weekdays, zero rate, fallback, validation, audit history, stale writes, admin identity and role permissions.");
} finally { await db.close(); }

