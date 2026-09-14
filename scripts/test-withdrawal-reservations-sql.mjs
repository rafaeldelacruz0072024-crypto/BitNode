// Runs the real migration against an isolated PostgreSQL engine. No live funds.
// node scripts/test-withdrawal-reservations-sql.mjs /path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const user = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const wallet = '0x0000000000000000000000000000000000000001';
const migration = new URL('../supabase/migrations/20260914155545_reserve_verified_withdrawals.sql', import.meta.url);
let serial = 0;
const query = (sql, params = []) => db.query(sql, params);
const balance = async () => Number((await query('select public.get_account_ledger_summary($1) summary', [user])).rows[0].summary.balance);
const challenge = async (amount, overrides = {}) => {
  const id = `10000000-0000-0000-0000-${String(++serial).padStart(12,'0')}`;
  await query(`insert into public.email_security_challenges(id,user_id,purpose,code_hash,payload,expires_at)
    values($1,$2,'withdrawal','valid-hash',$3::jsonb,now()+interval '10 minutes')`, [id,user,JSON.stringify({amount,network:'BNB Chain',wallet,...overrides})]);
  return id;
};
const confirm = (id, actor = user, hash = 'valid-hash') => query('select public.confirm_verified_withdrawal($1,$2,$3) result', [actor,id,hash]);
const status = (id, value) => query('update public.transactions set status=$2 where email_challenge_id=$1', [id,value]);
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key,username text);
    insert into auth.users values('${user}'),('${other}');
    insert into public.profiles values('${user}','test'),('${other}','other');
    create table public.transactions(id text primary key,user_id uuid references auth.users(id),username text,
      type text not null,label text not null,amount numeric(18,2) not null,status text not null,
      network text,wallet text,fee numeric(18,2),net_amount numeric(18,2),provider_status text,created_at timestamptz default now());
    grant select,insert,update,delete on public.transactions to authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20260909122656_email_security_challenges.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260903110000_manual_withdrawal_window.sql',import.meta.url),'utf8'));
  await db.exec('grant usage on schema public to service_role; grant all on all tables in schema public to service_role;');
  await db.exec(await readFile(migration,'utf8'));
  await db.exec(await readFile(new URL('../supabase/verify-withdrawal-reservations.sql',import.meta.url),'utf8'));
  assert.equal((await query('select count(*)::int n from transactions')).rows[0].n,0);
  await query(`insert into public.transactions(id,user_id,type,label,amount,status) values('deposit',$1,'deposit','Test deposit',100,'completed')`,[user]);
  const first = await challenge(60);
  await assert.rejects(confirm(first),/ventana/);
  assert.equal((await query('select consumed_at from email_security_challenges where id=$1',[first])).rows[0].consumed_at,null);
  await db.exec(`update platform_settings set value='{"enabled":true}' where key='withdrawal_window'`);
  await assert.rejects(confirm(first,other),/Código/);
  await assert.rejects(confirm(first,user,'bad-hash'),/Código/);
  const verified = (await confirm(first)).rows[0].result;
  assert.equal(verified.netAmount,57); assert.equal(verified.fee,3); assert.equal(await balance(),40);
  assert.equal((await confirm(first)).rows[0].result.id,verified.id);
  assert.equal(await balance(),40);
  await assert.rejects(confirm(await challenge(50)),/Saldo/);
  await assert.rejects(query(`insert into transactions(id,user_id,type,label,amount,status) values('node-blocked',$1,'contract','Node',-50,'completed')`,[user]),/Saldo/);
  await status(first,'approved'); assert.equal(await balance(),40);
  await status(first,'completed'); assert.equal(await balance(),40);
  await assert.rejects(status(first,'rejected'),/Transición/);
  const second = await challenge(20);
  await confirm(second); assert.equal(await balance(),20);
  await status(second,'rejected'); assert.equal(await balance(),40);
  await assert.rejects(status(second,'pending'),/Transición/);
  const third = await challenge(20);
  await confirm(third); await status(third,'approved'); await status(third,'rejected'); assert.equal(await balance(),40);
  const pending = await challenge(10);
  await confirm(pending);
  await assert.rejects(status(pending,'completed'),/Transición/);
  await assert.rejects(query('update transactions set wallet=$2 where email_challenge_id=$1',[pending,wallet.replace(/1$/,'2')]),/no se pueden modificar/);
  await status(pending,'rejected');
  await assert.rejects(query(`insert into transactions(id,user_id,type,label,amount,status,network,wallet)
    values('unverified',$1,'withdraw','Bypass',-10,'pending','BNB Chain',$2)`,[user,wallet]),/confirmación por correo/);
  const closedBetween = await challenge(10);
  await query('select public.validate_withdrawal_request($1,10)',[user]);
  await db.exec(`update platform_settings set value='{"enabled":false}' where key='withdrawal_window'`);
  await assert.rejects(confirm(closedBetween),/ventana/);
  await db.exec(`update platform_settings set value='{"enabled":true}' where key='withdrawal_window'`);
  await confirm(closedBetween); // Failed final check did not consume the code.
  assert.equal(await balance(),30);
  await status(closedBetween,'rejected');
  await assert.rejects(confirm(await challenge(10.001)),/confirmación|decimales/);
  await assert.rejects(confirm(await challenge(10,{network:'Ethereum'})),/no válidos/);
  const expired = await challenge(10);
  await query("update email_security_challenges set expires_at=now()-interval '1 second' where id=$1",[expired]);
  await assert.rejects(confirm(expired),/expiró/);
  const exhausted = await challenge(10);
  await query('update email_security_challenges set attempts=5 where id=$1',[exhausted]);
  await assert.rejects(confirm(exhausted),/intentos/);
  await query(`insert into transactions(id,user_id,type,label,amount,status) values('topup',$1,'deposit','Test topup',2000,'completed')`,[user]);
  // All requests, including rejections, count toward the existing UTC daily cap.
  const used = Number((await query("select sum(abs(amount)) n from transactions where type='withdraw'")).rows[0].n);
  const cap = await challenge(1000-used);
  await confirm(cap);
  await assert.rejects(confirm(await challenge(10)),/Límite diario/);
  const permissions = (await query(`select
    has_function_privilege('authenticated','public.confirm_verified_withdrawal(uuid,uuid,text)','EXECUTE') as user_confirm,
    has_function_privilege('service_role','public.confirm_verified_withdrawal(uuid,uuid,text)','EXECUTE') as server_confirm,
    has_table_privilege('authenticated','public.transactions','INSERT') as user_insert,
    has_table_privilege('authenticated','public.transactions','UPDATE') as user_update`)).rows[0];
  assert.deepEqual(permissions,{user_confirm:false,server_confirm:true,user_insert:false,user_update:false});
  await db.exec('set role service_role');
  assert.equal((await confirm(cap)).rows[0].result.status,'pending');
  await db.exec('reset role');
  assert.equal((await query("select count(*)::int n from transactions where id='node-blocked'")).rows[0].n,0);
  console.log('SQL verified: window before and after OTP, balance holds, node-spend protection, approve/pay/reject, replay, ownership, daily limit, wallet, precision, expiry, permissions and rollback.');
} catch (error) {
  console.error(error.message, error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
