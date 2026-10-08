import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table finite_node_capital_choices(new_contract_id text, action text);
    create table transactions(id text,provider_status text);
    create table network_nodes(user_id uuid);
    create table commission_events(source_event_id text primary key,contract_id text,user_id uuid,amount numeric,event_type text);
    create table corporate_accounts(user_id uuid);
    create table profiles(id uuid,sponsor_id uuid);
    create table network_volume(user_id uuid,leg text,volume numeric,matched_volume numeric,updated_at timestamptz);
    create table commission_ledger(id text);
  `);
  // Use the actual current engine through its no-network branch: new sales
  // create an event, excluded reinvestments must return before that write.
  const source = await readFile('supabase/migrations/20260922220528_require_active_node_for_commissions.sql','utf8');
  const engine = source.slice(source.indexOf('create or replace function public.process_contract_commissions('), source.indexOf('revoke all on function public.process_contract_commissions'));
  await db.exec(engine);
  const migration = await readFile('supabase/migrations/20261008165422_reinvestment_no_commissions.sql','utf8');
  await db.exec(migration);
  await db.exec(migration); // idempotent installation
  await db.exec(`set request.jwt.claim.role='service_role';
    insert into finite_node_capital_choices values('legacy-choice','reinvest');
    insert into transactions values('legacy-ledger','finite_capital_reinvested:promo_5_percent');`);
  const uid = '00000000-0000-0000-0000-000000000001';
  for (const id of ['REINVEST-NODE-1','legacy-choice','legacy-ledger']) {
    const { rows } = await db.query(`select process_contract_commissions($1,$2,$3,210) as result`,[id,id,uid]);
    assert.equal(rows[0].result.reason,'reinvestment_no_commissions');
    assert.equal(rows[0].result.direct,0);
    assert.equal(rows[0].result.binary,0);
  }
  assert.equal((await db.query('select count(*)::int as n from commission_events')).rows[0].n,0);
  await db.query(`select process_contract_commissions('new-sale','NODE-NEW',$1,200)`,[uid]);
  assert.equal((await db.query('select count(*)::int as n from commission_events')).rows[0].n,1);
  await db.exec(`set request.jwt.claim.role='authenticated'`);
  await assert.rejects(db.query(`select process_contract_commissions('blocked','REINVEST-1',$1,200)`,[uid]),/restricted/);
  console.log('PASS: three reinvestment identifiers excluded, no events/volume, new sale unchanged, authorization preserved, migration idempotent.');
} finally { await db.close(); }
