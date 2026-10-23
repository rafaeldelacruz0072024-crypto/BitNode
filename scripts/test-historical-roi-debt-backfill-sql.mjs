import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const resetUser='00000000-0000-0000-0000-000000000001';
const weekendUser='00000000-0000-0000-0000-000000000002';

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema bitnode_private;
    create table profiles(id uuid primary key,username text);
    create table transactions(id text primary key,user_id uuid,username text,type text,label text,amount numeric,status text,provider_status text,created_at timestamptz default now());
    create table contract_cycle_rewards(id uuid primary key default gen_random_uuid(),user_id uuid,transaction_id text,status text,created_at timestamptz default now());
    insert into profiles values('${resetUser}','reset-user'),('${weekendUser}','weekend-user');
    insert into transactions values
      ('YIELD-HIST-RESET','${resetUser}','reset-user','yield','roi',1399.49,'completed',null,'2026-10-20 12:00+00'),
      ('YIELD-HIST-WEEKEND','${weekendUser}','weekend-user','yield','roi',284.74,'completed',null,'2026-10-18 12:00+00');
    insert into contract_cycle_rewards(user_id,transaction_id,status,created_at) values
      ('${resetUser}','YIELD-HIST-RESET','reversed','2026-10-20 12:00+00'),
      ('${weekendUser}','YIELD-HIST-WEEKEND','completed','2026-10-18 12:00+00');
    create table bitnode_private.roi_recovery_debts(
      user_id uuid primary key references profiles(id),outstanding numeric not null default 0,
      accrued_total numeric not null default 0,recovered_total numeric not null default 0,
      created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create function bitnode_private.recover_roi_reset_debt() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger recover_roi_reset_debt after insert or update of status on transactions
      for each row execute function bitnode_private.recover_roi_reset_debt();
  `);
  const migration=await readFile(new URL('../supabase/migrations/20261023183000_backfill_reviewed_historical_roi_debt.sql',import.meta.url),'utf8');
  const sql=migration.replace("notify pgrst,'reload schema';",'');
  await db.exec(sql);

  let rows=(await db.query(`select username,outstanding,accrued_total from bitnode_private.roi_recovery_debts d join profiles p on p.id=d.user_id order by username`)).rows;
  assert.deepEqual(rows.map(r=>[r.username,Number(r.outstanding),Number(r.accrued_total)]),[
    ['reset-user',1399.49,1399.49],['weekend-user',284.74,284.74]
  ]);
  assert.equal(Number((await db.query(`select sum(amount) n from bitnode_private.roi_recovery_debt_sources`)).rows[0].n),1684.23);

  await db.exec(sql);
  assert.equal(Number((await db.query(`select sum(outstanding) n from bitnode_private.roi_recovery_debts`)).rows[0].n),1684.23);
  assert.equal(Number((await db.query(`select count(*) n from bitnode_private.roi_recovery_debt_sources`)).rows[0].n),2);

  await db.exec(`insert into transactions(id,user_id,username,type,label,amount,status,provider_status) values('YIELD-FUTURE','${weekendUser}','weekend-user','yield','roi',100,'completed',null)`);
  const weekendDebt=(await db.query(`select outstanding,recovered_total from bitnode_private.roi_recovery_debts where user_id='${weekendUser}'`)).rows[0];
  assert.equal(Number(weekendDebt.outstanding),184.74);
  assert.equal(Number(weekendDebt.recovered_total),100);
  assert.equal(Number((await db.query(`select amount n from transactions where id='ROI-DEBT-YIELD-FUTURE'`)).rows[0].n),-100);

  await db.exec(`insert into transactions(id,user_id,username,type,label,amount,status,provider_status) values('COMMISSION-HIST','${resetUser}','reset-user','yield','commission',50,'completed',null)`);
  assert.equal(Number((await db.query(`select outstanding n from bitnode_private.roi_recovery_debts where user_id='${resetUser}'`)).rows[0].n),1399.49);
  console.log('PASS: exact historical backfill, audit sources, idempotency and future-ROI-only recovery.');
} finally { await db.close(); }
