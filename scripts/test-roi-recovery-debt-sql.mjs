import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const uid = '00000000-0000-0000-0000-000000000001';

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema bitnode_private;
    create table profiles(id uuid primary key,username text);
    create table plans(id text primary key,duration_days int);
    create table contracts(id text primary key,user_id uuid,plan_id text,status text,amount numeric);
    create table transactions(id text primary key,user_id uuid,username text,type text,label text,amount numeric,status text,provider_status text,node_roi_spent numeric default 0);
    create table contract_cycle_rewards(id uuid primary key default gen_random_uuid(),user_id uuid,contract_id text,transaction_id text,status text,created_at timestamptz default now(),updated_at timestamptz);
    create table daily_task_cycles(user_id uuid primary key,cycle_day int,completed_tasks text[],window_started_at timestamptz,deadline_at timestamptz,last_task_at timestamptz,last_completed_at timestamptz,updated_at timestamptz);
    create table user_notifications(user_id uuid,kind text);
    insert into profiles values('${uid}','test');
    insert into plans values('p',7);
    insert into contracts values('active','${uid}','p','active',100);
    create function public.complete_daily_tasks(text) returns jsonb language plpgsql as $$ begin
      if extract(isodow from now() at time zone 'America/Santo_Domingo') not between 1 and 5 then return '{}'::jsonb; end if;
      return '{}'::jsonb;
    end $$;
    create function bitnode_private.run_sara_ia_daily() returns jsonb language plpgsql as $$ begin
      if extract(isodow from now() at time zone 'America/Santo_Domingo') not between 1 and 5 then return '{}'::jsonb; end if;
      return '{}'::jsonb;
    end $$;
  `);
  const migration = await readFile(new URL('../supabase/migrations/20261023154500_prevent_unrecovered_roi_and_use_mexico_weekdays.sql', import.meta.url),'utf8');
  await db.exec(migration.replace("notify pgrst,'reload schema';",''));

  await db.exec(`
    insert into daily_task_cycles values('${uid}',2,array['task'],now(),now(),now(),now(),now());
    insert into transactions values('YIELD-OLD','${uid}','test','yield','roi',30,'completed',null,0);
    insert into transactions values('SPENT','${uid}','test','contract','spent',-30,'completed',null,0);
    insert into contract_cycle_rewards(user_id,contract_id,transaction_id,status) values('${uid}','active','YIELD-OLD','completed');
    select reset_daily_cycle_for_user('${uid}','missed_24h_window');
  `);
  let debt = (await db.query(`select * from bitnode_private.roi_recovery_debts where user_id='${uid}'`)).rows[0];
  assert.equal(Number(debt.outstanding),30);
  assert.equal(Number(debt.accrued_total),30);

  await db.exec(`insert into transactions values('YIELD-NEW-1','${uid}','test','yield','roi',12,'completed',null,0)`);
  debt = (await db.query(`select * from bitnode_private.roi_recovery_debts where user_id='${uid}'`)).rows[0];
  assert.equal(Number(debt.outstanding),18);
  assert.equal(Number(debt.recovered_total),12);
  assert.equal(Number((await db.query(`select amount n from transactions where id='ROI-DEBT-YIELD-NEW-1'`)).rows[0].n),-12);

  await db.exec(`insert into transactions values('COMMISSION-1','${uid}','test','yield','commission',50,'completed',null,0)`);
  debt = (await db.query(`select outstanding from bitnode_private.roi_recovery_debts where user_id='${uid}'`)).rows[0];
  assert.equal(Number(debt.outstanding),18);

  await db.exec(`insert into transactions values('YIELD-NEW-2','${uid}','test','yield','roi',25,'completed',null,0)`);
  debt = (await db.query(`select * from bitnode_private.roi_recovery_debts where user_id='${uid}'`)).rows[0];
  assert.equal(Number(debt.outstanding),0);
  assert.equal(Number(debt.recovered_total),30);
  assert.equal(Number((await db.query(`select amount n from transactions where id='ROI-DEBT-YIELD-NEW-2'`)).rows[0].n),-18);

  await db.exec(`update transactions set status='completed' where id='YIELD-NEW-2'`);
  assert.equal(Number((await db.query(`select count(*) n from transactions where id like 'ROI-DEBT-%'`)).rows[0].n),2);

  const taskBody=(await db.query(`select pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure) body`)).rows[0].body;
  const saraBody=(await db.query(`select pg_get_functiondef('bitnode_private.run_sara_ia_daily()'::regprocedure) body`)).rows[0].body;
  assert.match(taskBody,/America\/Mexico_City/);
  assert.doesNotMatch(taskBody,/America\/Santo_Domingo/);
  assert.match(saraBody,/America\/Mexico_City/);
  assert.equal((await db.query(`select bitnode_private.next_business_task_deadline('2026-10-25 12:00+00') at time zone 'America/Mexico_City' d`)).rows[0].d.getUTCDay(),1);

  console.log('PASS: future reset debt, ROI-only recovery, partial/full settlement, idempotency and Mexico weekday policy.');
} finally {
  await db.close();
}
