// Isolated PostgreSQL tests. Never points at the production database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const user='00000000-0000-0000-0000-000000000001';
const q=(sql,params=[])=>db.query(sql,params);
const scalar=async sql=>Object.values((await q(sql)).rows[0])[0];
const at=async value=>q("select set_config('test.now',$1,false)",[value]);
const tasks=async()=>{let result; for(const task of ['sync_node','validate_block','audit_mempool','sign_checkpoint']) result=(await q('select public.complete_daily_tasks($1) result',[task])).rows[0].result; return result;};
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema bitnode_private;
    create function auth.uid() returns uuid language sql stable as $$select '${user}'::uuid$$;
    create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');
    create table public.profiles(id uuid primary key,username text,role text);
    insert into auth.users values('${user}','{"withdrawal_wallet_bep20":"0x0000000000000000000000000000000000000001"}');
    insert into public.profiles values('${user}','test','user');
    create table public.plans(id text primary key,name text,slug text unique,rate_min numeric,rate_max numeric,cadence text,duration_days integer,min_amount numeric,principal_returned boolean,active boolean,created_at timestamptz default now());
    insert into public.plans(id,name,slug,rate_min,rate_max,cadence,duration_days,min_amount,principal_returned,active)
      values('21d','Nodo 21 Días','21d',.04,.05,'business_days',21,10,true,true),('daily','Nodo Diario','daily',.01,.015,'business_days',null,10,false,true);
    create table public.platform_settings(key text primary key,value jsonb);
    create table public.contracts(id text primary key,user_id uuid,plan_id text,amount numeric,status text,starts_at timestamptz default now(),ends_at timestamptz,principal_returned_at timestamptz,created_at timestamptz default now());
    create table public.transactions(id text primary key,user_id uuid,username text,type text,label text,amount numeric,status text,created_at timestamptz default now(),provider_status text,node_roi_spent numeric default 0,direct_commission_spent numeric default 0,weekly_bonus_spent numeric default 0,withdrawal_day date);
    create table public.daily_task_cycles(user_id uuid primary key,cycle_day integer default 0,completed_tasks text[] default '{}',window_started_at timestamptz,deadline_at timestamptz,last_task_at timestamptz,last_completed_at timestamptz,updated_at timestamptz);
    create table public.contract_cycle_rewards(id uuid primary key default gen_random_uuid(),user_id uuid,contract_id text,reward_date date,rate numeric,amount numeric,status text,transaction_id text,created_at timestamptz default now(),updated_at timestamptz,unique(contract_id,reward_date));
    create table public.commission_ledger(id uuid,beneficiary_id uuid,commission_type text,status text,created_at timestamptz);
    create table public.finite_node_capital_choices(contract_id text primary key,user_id uuid,action text,status text,amount numeric,fee numeric,net_amount numeric,wallet text,payable_at timestamptz,claim_day date,new_contract_id text);
    create function public.reset_daily_cycle_for_user(uuid,text) returns void language sql as $$select$$;
    create function bitnode_private.next_business_task_deadline(timestamptz) returns timestamptz language sql as $$select $1$$;
    create function bitnode_private.monthly_daily_rate(integer,date) returns numeric language sql as $$select case when $1=21 then .04::numeric else .01::numeric end$$;
  `);
  await db.exec(await readFile(new URL('./fixtures/nodes-v2-before.sql',import.meta.url),'utf8'));
  const legacyPlan=await scalar("select to_jsonb(p)::text from plans p where id='21d'");
  const oldLegacyRate=await scalar("select bitnode_private.monthly_daily_rate(21,'2026-11-03')");
  await db.exec(await readFile(new URL('../supabase/migrations/20261103172422_nodes_v2_catalog_and_rules.sql',import.meta.url),'utf8'));
  assert.equal(await scalar("select (to_jsonb(p)-'node_version')::text from plans p where id='21d'"),legacyPlan);
  assert.equal(await scalar("select bitnode_private.plan_daily_rate('21d',21,'2026-11-03')"),oldLegacyRate);
  assert.equal(await scalar('select count(*)::int from plans where node_version=2 and active'),0);
  await assert.rejects(q(`insert into contracts(id,user_id,plan_id,amount,status) values('blocked',$1,'v2-10d',1000,'active')`,[user]),/no están habilitados/);
  await db.exec("update plans set active=true where node_version=2");
  await assert.rejects(q(`insert into contracts(id,user_id,plan_id,amount,status) values('blocked-flag',$1,'v2-10d',1000,'active')`,[user]),/no están habilitados/);
  assert.equal(await scalar('select count(*)::int from contracts'),0);
  await assert.rejects(q("update plans set rate_max=.08 where id='v2-33d'"),/retroactivamente/);
  await assert.rejects(q("update plans set node_version=2 where id='21d'"),/generación/);
  assert.equal(await scalar("select bitnode_private.add_mexico_business_days('2026-11-06 12:00:00-06',10)::text"),'2026-11-20 18:00:00+00');
  for(const [id,min,max] of [['v2-10d',.005,.007],['v2-17d',.008,.011],['v2-33d',.013,.021]]) {
    const rates=(await q('select bitnode_private.plan_daily_rate($1,null,current_date)::float8 rate from generate_series(1,1000)',[id])).rows;
    assert.ok(rates.every(row=>row.rate>=min && row.rate<=max));
  }
  // Controlled clock exists only in this disposable engine, never in migration.
  await db.exec(`create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select coalesce(nullif(current_setting('test.now',true),'')::timestamptz,transaction_timestamp())$$;`);
  // CURRENT_DATE uses the engine's wall clock, so route only the fixture's
  // date keyword through our controlled UTC clock for multi-day simulation.
  const clockedTasks=(await scalar("select pg_get_functiondef('public.complete_daily_tasks(text)'::regprocedure)"))
    .replaceAll('current_date',"(now() at time zone 'UTC')::date");
  await db.exec(clockedTasks);
  await at('2026-11-03T18:00:00Z');
  await db.exec("update platform_settings set value='{\"enabled\":true}' where key='nodes_v2_release'; update plans set active=true where node_version=2;");
  await q("insert into contracts(id,user_id,plan_id,amount,status) values('new10',$1,'v2-10d',1000,'active'),('new17',$1,'v2-17d',1000,'active'),('new33',$1,'v2-33d',1000,'active'),('old21',$1,'21d',1000,'active')",[user]);
  await assert.rejects(q("update contracts set plan_id='v2-10d' where id='old21'"),/convertir/);
  for(let day=0;day<33;day++) {
    const clock=new Date('2026-11-03T18:00:00Z'); let remaining=day;
    while(remaining>0) {clock.setUTCDate(clock.getUTCDate()+1); if(clock.getUTCDay()>0&&clock.getUTCDay()<6)remaining--;}
    await at(clock.toISOString());
    const result=await tasks();
    assert.equal(result.status,'credited');
    if (await scalar("select count(*)::int from contracts where status='active'")) {
      const duplicate=await tasks(); assert.equal(duplicate.status,'day_already_completed');
    } else await assert.rejects(tasks(),/active node/);
  }
  const all=(await q("select c.id,c.status,count(r.id)::int days,sum(r.amount)::float8 roi from contracts c join contract_cycle_rewards r on r.contract_id=c.id group by c.id,c.status")).rows;
  for(const [id,days,min,max] of [['new10',10,50,70],['new17',17,136,187],['new33',33,429,693],['old21',21,840,840]]) {
    const row=all.find(r=>r.id===id); assert.equal(row.status,'completed'); assert.equal(row.days,days); assert.ok(row.roi>=min-0.00001&&row.roi<=max+0.00001);
    assert.equal(await scalar(`select count(*)::int from transactions where id='PRINCIPAL-${id}'`),1);
  }
  const offWindow=await scalar(`select public.get_withdrawal_availability('${user}','2026-12-21 12:00:00-06')`);
  assert.equal(offWindow.weeklyWindowOpen,false);
  assert.ok(Number(offWindow.lockedNodeRoi)>840);
  const openWindow=await scalar(`select public.get_withdrawal_availability('${user}','2026-12-23 12:00:00-06')`);
  assert.equal(openWindow.weeklyWindowOpen,true);
  assert.equal(Number(openWindow.lockedNodeRoi),0);
  await at('2026-12-21T18:00:00Z');
  const choice=(await q("select public.choose_finite_node_capital($1,'new10','reinvest') result",[user])).rows[0].result;
  assert.equal(choice.status,'reinvested');
  assert.equal(await scalar("select plan_id from contracts where id='REINVEST-new10'"),'v2-10d');
  await assert.rejects(q("select public.choose_finite_node_capital($1,'new10','reinvest')",[user]),/ya fue asignado/);
  const claim=(await q("select public.choose_finite_node_capital($1,'new17','claim') result",[user])).rows[0].result;
  assert.equal(claim.status,'pending');
  assert.equal(Number(await scalar("select net_amount from finite_node_capital_choices where contract_id='new17'")),950);
  await at('2026-12-26T18:00:00Z');
  await assert.rejects(tasks(),/lunes a viernes/);
  console.log('PASS: legacy terms and ROI, V2 launch gate, immutable terms, business days, 10/17/33 full cycles, bounds, idempotency, principal, Wednesday buckets, reinvestment and weekends.');
} catch(error) { console.error(error.message,error.where || ''); process.exitCode=1; }
finally { await db.close(); }
