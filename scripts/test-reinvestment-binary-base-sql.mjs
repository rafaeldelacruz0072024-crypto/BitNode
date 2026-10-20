import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const parent='00000000-0000-0000-0000-000000000001', child='00000000-0000-0000-0000-000000000002';
try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table plans(id text primary key,active boolean);
 create table contracts(id text primary key,user_id uuid,plan_id text,status text,amount numeric);
 create table profiles(id uuid primary key,sponsor_id uuid);
 create table corporate_accounts(user_id uuid primary key);
 create table network_nodes(user_id uuid primary key,parent_id uuid,leg text,sponsor_id uuid);
 create table network_volume(user_id uuid,leg text,volume numeric,matched_volume numeric,updated_at timestamptz,unique(user_id,leg));
 create table commission_events(source_event_id text primary key,contract_id text,user_id uuid,amount numeric,event_type text);
 create table commission_ledger(beneficiary_id uuid,source_user_id uuid,source_event_id text,commission_type text,amount numeric,rate numeric,leg text,status text,metadata jsonb,unique(source_event_id,commission_type,beneficiary_id,leg));
 create table transactions(id text primary key,user_id uuid,type text,status text,amount numeric,provider_status text);
 create table finite_node_capital_choices(new_contract_id text primary key,user_id uuid,action text,status text,amount numeric);
 insert into plans values('21',true);
 insert into contracts values('parent-node','${parent}','21','active',100);
 insert into profiles values('${parent}',null),('${child}','${parent}');
 insert into network_nodes values('${parent}',null,null,null),('${child}','${parent}','left','${parent}');
 insert into network_volume values('${parent}','right',10000,0,now());`);
 await db.exec(await readFile('supabase/migrations/20260922220528_require_active_node_for_commissions.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261008165422_reinvestment_no_commissions.sql','utf8'));
 const patch=await readFile('supabase/migrations/20261020155501_reinvestment_binary_base_only.sql','utf8');
 await db.exec(patch); await db.exec(patch);
 const privileges=(await db.query(`select has_function_privilege('anon','public.process_contract_commissions(text,text,uuid,numeric,text)','EXECUTE') anon,has_function_privilege('authenticated','public.process_contract_commissions(text,text,uuid,numeric,text)','EXECUTE') authenticated,has_function_privilege('service_role','public.process_contract_commissions(text,text,uuid,numeric,text)','EXECUTE') service`)).rows[0];
 assert.deepEqual(privileges,{anon:false,authenticated:false,service:true});
 await db.exec(`set request.jwt.claim.role='service_role'`);
 const call=async(id,amount=210,event=id)=> (await db.query(`select process_contract_commissions($1,$2,$3,$4) result`,[event,id,child,amount])).rows[0].result;
 const left=async()=>Number((await db.query(`select volume from network_volume where user_id=$1 and leg='left'`,[parent])).rows[0]?.volume||0);
 // Dispatch during transaction insertion: base debit, not promotional contract amount.
 await db.query(`insert into transactions values('REINVEST-1',$1,'contract','completed',-200,'finite_capital_reinvested:promo_5_percent')`,[child]);
 const first=await call('REINVEST-1'); assert.equal(first.direct,0); assert.equal(first.binary,16); assert.equal(await left(),200);
 // Choice integration must not repeat a previously dispatched event.
 await db.query(`insert into finite_node_capital_choices values('REINVEST-1',$1,'reinvest','reinvested',200)`,[child]);
 assert.equal(await left(),200);
 assert.equal((await call('REINVEST-1',210,'different-event')).status,'duplicate');
 assert.equal(await left(),200);
 // A choice without a prior dispatcher must credit its base automatically.
 await db.query(`insert into finite_node_capital_choices values('legacy-choice',$1,'reinvest','reinvested',100)`,[child]);
 assert.equal(await left(),300);
 assert.equal((await call('legacy-choice',105)).status,'duplicate');
 // Alternate legacy marker, with inflated caller amount, still uses base.
 await db.query(`insert into transactions values('legacy-ledger',$1,'contract','completed',-50,'finite_capital_reinvested')`,[child]);
 assert.equal((await call('legacy-ledger',99999)).binary,4); assert.equal(await left(),350);
 assert.equal(Number((await db.query(`select count(*) n from commission_ledger where commission_type='direct'`)).rows[0].n),0);
 await assert.rejects(call('REINVEST-UNVERIFIED'),/Verified reinvestment base required/);
 const wrong='00000000-0000-0000-0000-000000000099';
 await assert.rejects(db.query(`select process_contract_commissions('bad','REINVEST-1',$1,200)`,[wrong]),/Verified reinvestment base required/);
 // New investment preserves the direct 10% and matching binary 8%.
 const sale=await call('NODE-NEW',100); assert.equal(sale.direct,10); assert.equal(sale.binary,8);
 // Inactive parent receives no commission, but matching volume remains consumed.
 await db.exec(`update contracts set status='completed' where id='parent-node'`);
 await db.query(`insert into finite_node_capital_choices values('inactive-choice',$1,'reinvest','reinvested',100)`,[child]);
 assert.equal(await left(),550);
 assert.equal(Number((await db.query(`select sum(amount) n from commission_ledger where commission_type='binary'`)).rows[0].n),36);
 // Corporate exclusion is unchanged.
 await db.query(`insert into corporate_accounts values($1)`,[child]);
 await db.query(`insert into finite_node_capital_choices values('corporate-choice',$1,'reinvest','reinvested',100)`,[child]);
 assert.equal(await left(),550);
 await db.exec(`set request.jwt.claim.role='authenticated'`);
 await assert.rejects(call('REINVEST-1'),/restricted/);
 // Trigger failure must roll back the choice atomically.
 await assert.rejects(db.query(`insert into finite_node_capital_choices values('denied-choice',$1,'reinvest','reinvested',100)`,[child]),/restricted/);
 assert.equal(Number((await db.query(`select count(*) n from finite_node_capital_choices where new_contract_id='denied-choice'`)).rows[0].n),0);
 // Real 5% BEFORE trigger + new AFTER trigger: node gets 210, binary gets 200.
 await db.exec(`set request.jwt.claim.role='service_role';
 delete from corporate_accounts;
 update contracts set status='active' where id='parent-node';
 alter table plans add column name text default 'Nodo 21 Días';
 alter table transactions add column label text;
 insert into contracts values('REINVEST-BONUS','${child}','21','active',200);
 insert into transactions(id,user_id,type,status,amount,provider_status) values('REINVEST-BONUS','${child}','contract','completed',-200,'finite_capital_reinvested');`);
 await db.exec(await readFile('supabase/migrations/20261001004519_reinvestment_bonus_capital_5_percent.sql','utf8'));
 await db.query(`insert into finite_node_capital_choices values('REINVEST-BONUS',$1,'reinvest','reinvested',200)`,[child]);
 assert.equal(Number((await db.query(`select amount from contracts where id='REINVEST-BONUS'`)).rows[0].amount),210);
 assert.equal(await left(),750);
 assert.equal(Number((await db.query(`select amount from commission_events where contract_id='REINVEST-BONUS'`)).rows[0].amount),200);
 assert.equal(Number((await db.query(`select sum(amount) n from commission_ledger where source_event_id='REINVEST-BINARY-REINVEST-BONUS' and commission_type='binary'`)).rows[0].n),16);
 assert.equal(Number((await db.query(`select count(*) n from commission_ledger where source_event_id='REINVEST-BINARY-REINVEST-BONUS' and commission_type='direct'`)).rows[0].n),0);
 console.log('PASS: base-only binary 8%, zero direct, canonical replay protection, transaction/choice order, automatic trigger, inflated input rejection, ownership, new sales unchanged, inactive/corporate exclusions, atomic rollback, permissions and repeatable migration.');
} finally { await db.close(); }
