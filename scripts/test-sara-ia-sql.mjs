import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const uid = '00000000-0000-0000-0000-000000000001';
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema cron; create schema bitnode_private;
    create table auth.users(id uuid primary key);
    create table plans(id text primary key, duration_days integer, active boolean);
    create table contracts(user_id uuid,plan_id text,status text,created_at timestamptz);
    create table daily_task_cycles(user_id uuid primary key, completed_tasks text[],deadline_at timestamptz);
    create table test_clock(at timestamptz);
    insert into test_clock values('2026-10-02 12:00-04');
    create function public.test_now() returns timestamptz language sql as $$ select at from public.test_clock $$;
    create table test_control(fail boolean, credits integer);
    insert into test_control values(false,0);
    create table cron.job(jobid bigint,jobname text,schedule text,active boolean,command text);
    create function cron.unschedule(bigint) returns boolean language sql as $$ select true $$;
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job values(1,$1,$2,true,$3) returning jobid $$;
    insert into auth.users values('${uid}');
    insert into plans values('p',21,true);
    insert into contracts values('${uid}','p','active','2026-09-01');
    create function public.complete_daily_tasks(k text) returns jsonb language plpgsql set search_path=public as $$
    declare tasks text[]; deadline timestamptz; u uuid := current_setting('request.jwt.claim.sub')::uuid;
    begin
      if (select fail from test_control) then raise exception 'temporary failure'; end if;
      select completed_tasks,deadline_at into tasks,deadline from daily_task_cycles where user_id=u for update;
      if tasks is null or deadline <= public.test_now() then tasks := array[]::text[]; end if;
      if cardinality(tasks)=4 then return jsonb_build_object('status','day_already_completed'); end if;
      if k=any(tasks) then return jsonb_build_object('status','already_completed'); end if;
      tasks := array_append(tasks,k);
      insert into daily_task_cycles values(u,tasks,public.test_now()+interval '24 hours')
        on conflict(user_id) do update set completed_tasks=excluded.completed_tasks,deadline_at=excluded.deadline_at;
      if cardinality(tasks)=4 then
        update test_control set credits=credits+1;
        return jsonb_build_object('status','credited');
      end if;
      return jsonb_build_object('status','task_completed');
    end $$;
  `);
  const migration = await readFile(new URL('../supabase/migrations/20261002201950_sara_ia_subscription_and_autopilot.sql', import.meta.url), 'utf8');
  // Only the test harness substitutes the clock and mocks pg_cron.
  await db.exec(migration.replace('create extension if not exists pg_cron with schema pg_catalog;', '').replaceAll('now()', 'public.test_now()'));
  const thirtyDays = await readFile(new URL('../supabase/migrations/20261003000934_sara_ia_30_calendar_days.sql', import.meta.url), 'utf8');
  await db.exec(thirtyDays.replaceAll('now()', 'public.test_now()'));
  const run = async () => (await db.query('select bitnode_private.run_sara_ia_daily() result')).rows[0].result;
  assert.equal((await run()).status,'before_launch');
  await assert.rejects(db.exec(`insert into sara_ia_payments(order_id,user_id,pay_currency) values('early','${uid}','usdtbsc')`), /lunes 5/);
  await db.exec(`update test_clock set at='2026-10-05 08:00-04';
    insert into sara_ia_subscriptions(user_id,paid_through_at) values('${uid}','2026-11-05');
    insert into daily_task_cycles values('${uid}',array['sync_node','validate_block'],'2026-10-05 07:00-04');`);
  assert.equal((await run()).completed,1);
  assert.equal((await db.query('select status from sara_ia_runs')).rows[0].status,'completed');
  assert.equal((await db.query('select cardinality(completed_tasks) n from daily_task_cycles')).rows[0].n,4);
  assert.equal((await run()).completed,0);
  assert.equal((await db.query('select credits from test_control')).rows[0].credits,1);
  await db.exec(`update test_clock set at='2026-10-06 09:00-04'; update test_control set fail=true;`);
  assert.equal((await run()).failed,1);
  await db.exec('update test_control set fail=false');
  assert.equal((await run()).completed,1);
  assert.equal((await db.query('select credits from test_control')).rows[0].credits,2);
  await db.exec(`update test_clock set at='2026-10-07 10:00-04'; update contracts set status='completed';`);
  assert.equal((await run()).completed,0);
  await assert.rejects(db.exec(`insert into sara_ia_payments(order_id,user_id,pay_currency) values('no-node','${uid}','usdtbsc')`), /21 días activo/);
  await db.exec(`update contracts set status='active';
    insert into sara_ia_payments(order_id,user_id,pay_currency,provider_payment_id,expected_pay_amount)
    values('paid','${uid}','usdtbsc','provider',25);
    select complete_sara_ia_payment('paid','provider','usdtbsc',25,25);`);
  const expiry = (await db.query('select paid_through_at::text expiry from sara_ia_subscriptions')).rows[0].expiry;
  assert.equal(Number((await db.query(`select extract(epoch from (paid_through_at-timestamptz '2026-11-05'))/86400 days from sara_ia_subscriptions`)).rows[0].days),30);
  await db.exec(`select complete_sara_ia_payment('paid','provider','usdtbsc',25,25)`);
  assert.equal((await db.query('select paid_through_at::text expiry from sara_ia_subscriptions')).rows[0].expiry,expiry);
  await db.exec(`update test_clock set at='2027-01-31 12:00-04';
    insert into sara_ia_payments(order_id,user_id,pay_currency,provider_payment_id,expected_pay_amount)
    values('expired-renewal','${uid}','usdtbsc','provider-2',25);
    select complete_sara_ia_payment('expired-renewal','provider-2','usdtbsc',25,25);`);
  assert.equal(Number((await db.query(`select extract(epoch from (paid_through_at-public.test_now()))/86400 days from sara_ia_subscriptions`)).rows[0].days),30);
  await db.exec(`update test_clock set at='2026-10-10 10:00-04'`);
  assert.equal((await run()).status,'weekend');
  await db.exec('set role authenticated');
  await assert.rejects(run(),/permission denied/);
  console.log('PASS: migration compilation; Monday launch; expired partial cycle; 4/4; duplicate prevention; failure retry; 21-day rule; renewal/IPN idempotency; weekend and permissions. Canonical task RPC and cron are mocked, not production-verified.');
} finally { await db.close(); }
