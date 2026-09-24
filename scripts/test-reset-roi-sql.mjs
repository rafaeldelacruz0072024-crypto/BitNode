import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const uid = '00000000-0000-0000-0000-000000000001';
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema bitnode_private;
    create table profiles(id uuid primary key,username text);
    create table plans(id text primary key,duration_days int);
    create table contracts(id text primary key,user_id uuid,plan_id text,status text,amount numeric);
    create table transactions(id text primary key,user_id uuid,username text,type text,label text,amount numeric,status text,provider_status text,node_roi_spent numeric default 0);
    create table contract_cycle_rewards(id uuid primary key default gen_random_uuid(),user_id uuid,contract_id text,transaction_id text,status text,created_at timestamptz default now(),updated_at timestamptz);
    create table daily_task_cycles(user_id uuid primary key,cycle_day int,completed_tasks text[],window_started_at timestamptz,deadline_at timestamptz,last_task_at timestamptz,last_completed_at timestamptz,updated_at timestamptz);
    create table user_notifications(user_id uuid,kind text);
    insert into profiles values('${uid}','test'); insert into plans values('p',7);
    insert into contracts values('active','${uid}','p','active',100),('finished','${uid}','p','completed',100);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260924220220_reverse_failed_cycle_roi.sql', import.meta.url),'utf8'));
  async function scenario(spent, reserved = false) {
    await db.exec(`truncate transactions,contract_cycle_rewards,daily_task_cycles,user_notifications;
      insert into daily_task_cycles values('${uid}',3,array['task'],now(),now(),now(),now(),now());
      insert into transactions(id,user_id,type,amount,status) values
        ('YIELD-1','${uid}','yield',10,'completed'),('YIELD-2','${uid}','yield',10,'completed'),('YIELD-3','${uid}','yield',10,'completed'),
        ('YIELD-old','${uid}','yield',5,'completed'),('PRINCIPAL-old','${uid}','deposit',100,'completed'),('capital','${uid}','contract',-100,'completed'),
        ('commission','${uid}','yield',5,'completed'),('YIELD-pending','${uid}','yield',10,'pending');
      insert into contract_cycle_rewards(user_id,contract_id,transaction_id,status) values
        ('${uid}','active','YIELD-1','pending'),('${uid}','active','YIELD-2','pending'),('${uid}','active','YIELD-3','pending'),
        ('${uid}','finished','YIELD-old','completed'),('${uid}','active','YIELD-pending','pending');
      insert into transactions(id,user_id,type,amount,status,node_roi_spent) values('spent','${uid}','withdraw',-${spent},'${reserved ? 'pending' : 'completed'}',${Math.min(spent,30)});
      select reset_daily_cycle_for_user('${uid}','missed_24h_window');`);
    const summary = (await db.query(`select get_account_ledger_summary('${uid}') as s`)).rows[0].s;
    assert.equal(summary.balance, Math.max(40-spent-30,0));
    const debit = Number((await db.query(`select coalesce(sum(amount),0) as n from transactions where id like 'YIELD-RESET-%'`)).rows[0].n);
    assert.equal(debit, -Math.min(30,40-spent) || 0);
    assert.equal((await db.query(`select status from transactions where id='YIELD-pending'`)).rows[0].status,'reversed');
    assert.equal((await db.query(`select amount::float8 n from contracts where id='active'`)).rows[0].n,100);
    assert.equal((await db.query(`select status from contract_cycle_rewards where transaction_id='YIELD-old'`)).rows[0].status,'completed');
    assert.equal((await db.query(`select count(*)::int n from user_notifications`)).rows[0].n,1);
    await db.exec(`select reset_daily_cycle_for_user('${uid}','missed_24h_window')`);
    assert.deepEqual((await db.query(`select get_account_ledger_summary('${uid}') as s`)).rows[0].s,summary);
    assert.equal((await db.query(`select count(*)::int n from user_notifications`)).rows[0].n,1);
    assert.equal((await db.query(`select cycle_day from daily_task_cycles`)).rows[0].cycle_day,0);
    const available = Number((await db.query(`select bitnode_private.unspent_finite_node_roi('${uid}') n`)).rows[0].n);
    assert.equal(available, Math.max(35+debit-Math.min(spent,30),0));
  }
  await scenario(0); await scenario(25); await scenario(40); await scenario(25,true);
  await db.exec('set role authenticated');
  await assert.rejects(db.exec(`select reset_daily_cycle_for_user('${uid}','missed_24h_window')`),/permission denied/);
  console.log('PASS: 3-day ROI debit, insufficient/zero balance without debt, reserved withdrawals, unchanged principal/completed nodes/commissions, idempotency, progress, ROI bucket and permissions.');
} finally { await db.close(); }
