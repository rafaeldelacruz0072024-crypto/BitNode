import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const admin = "00000000-0000-0000-0000-000000000001";
const sponsor = "00000000-0000-0000-0000-000000000002";
const buyer = "00000000-0000-0000-0000-000000000003";
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema bitnode_private;
 create table profiles(id uuid primary key,username text,role text,sponsor_id uuid);
 create table contracts(id text primary key,user_id uuid,amount numeric,status text,created_at timestamptz);
 create table transactions(id text primary key,user_id uuid,type text,status text,amount numeric,provider_payment_id text,provider_status text,created_at timestamptz);
 create table finite_node_capital_choices(new_contract_id text,action text);
 create table admin_operation_audit_log(admin_id uuid,admin_username text,action text,target_type text,target_id text,details jsonb);
 insert into profiles values('${admin}','admin','admin',null),('${sponsor}','lider','user',null),('${buyer}','comprador','user','${sponsor}');`);
  await db.exec(
    await readFile(
      "supabase/migrations/20261015211352_latam_promotions.sql",
      "utf8"
    )
  );
  const prizeMigration = await readFile(
    "supabase/migrations/20261015235040_latam_trip_and_iphone_raffle.sql",
    "utf8"
  );
  await db.exec(prizeMigration);
  await db.exec(prizeMigration); // Reapplying this update must not reset sales.
  const seed = async (
    id,
    deposit,
    at = "2026-10-16T06:00:00Z",
    provider = "confirmed",
    amount = 15000
  ) => {
    await db.query(`insert into contracts values($1,$2,$3,'active',$4)`, [
      id,
      buyer,
      amount,
      at,
    ]);
    await db.query(
      `insert into transactions values($1,$2,'contract','completed',-$3::numeric,null,null,$4)`,
      [id, buyer, amount, at]
    );
    await db.query(
      `insert into transactions values($1,$2,'deposit','completed',$3,'proof',$4,$5)`,
      [deposit, buyer, amount, provider, at]
    );
  };
  const validate = (id, deposit, amount = 15000, who = admin, revoke = false) =>
    db.query(
      `select admin_validate_latam_sale($1,$2,$3,$4,'Pago real confirmado y conciliado',$5)`,
      [who, id, deposit, amount, revoke]
    );
  const snapshot = async (userId = sponsor, adminMode = false) =>
    (
      await db.query(`select get_latam_promotion($1,$2) data`, [
        userId,
        adminMode,
      ])
    ).rows[0].data;
  await seed("NODE-1", "NP-1");
  await assert.rejects(
    validate("NODE-1", "NP-1", 15000, buyer),
    /Administrador/
  );
  await validate("NODE-1", "NP-1");
  assert.equal(Number((await snapshot()).total), 15000);
  assert.equal((await snapshot()).winners[0].username, "lider");
  assert.equal((await snapshot()).winners[0].prize, "trip");
  assert.equal((await snapshot()).raffleEligible, false);
  assert.equal((await snapshot()).rulesVersion, "latam-trip-raffle-v2");
  await assert.rejects(validate("NODE-1", "NP-1"), /supera|duplicate/);
  await db.exec(`update transactions set status='reversed' where id='NP-1'`);
  assert.equal(Number((await snapshot()).total), 0);
  assert.equal((await snapshot()).winners.length, 0);
  await db.exec(`update transactions set status='completed' where id='NP-1'`);
  await validate("NODE-1", "NP-1", 15000, admin, true);
  assert.equal(Number((await snapshot()).total), 0);
  for (const [id, deposit, at, provider] of [
    ["EARLY", "NP-EARLY", "2026-10-16T05:59:59Z", "confirmed"],
    ["LATE", "NP-LATE", "2026-11-26T06:00:00Z", "confirmed"],
    ["REINVEST-NODE", "NP-REINVEST", "2026-10-16T06:00:00Z", "confirmed"],
    ["BONUS", "BONUS-1", "2026-10-16T06:00:00Z", "promo_cashback:5"],
    ["PENDING", "NP-PENDING", "2026-10-16T06:00:00Z", "waiting"],
  ]) {
    await seed(id, deposit, at, provider);
    await assert.rejects(validate(id, deposit), /No elegible/);
  }
  await seed(
    "MANUAL",
    "ADMIN-REAL",
    "2026-11-26T05:59:59Z",
    `admin_manual:${admin}`
  );
  await validate("MANUAL", "ADMIN-REAL", 14999);
  assert.equal((await snapshot()).winners.length, 0);
  assert.equal((await snapshot()).raffleEligible, true);
  assert.equal(Number((await snapshot()).raffleParticipantCount), 1);
  await seed("NODE-EXTRA", "NP-EXTRA", "2026-11-26T05:59:59Z", "finished", 1);
  await validate("NODE-EXTRA", "NP-EXTRA", 1);
  assert.equal((await snapshot()).winners.length, 1);
  assert.equal(Number((await snapshot()).total), 15000);
  assert.equal((await snapshot()).raffleEligible, false);
  assert.equal(Number((await snapshot()).raffleParticipantCount), 0);
  const privileges = await db.query(
    `select has_function_privilege('authenticated','public.admin_validate_latam_sale(uuid,text,text,numeric,text,boolean)','execute') allowed`
  );
  assert.equal(privileges.rows[0].allowed, false);
  assert.equal(
    (await db.query(`select count(*)::int n from admin_operation_audit_log`))
      .rows[0].n,
    4
  );
  // At most ten winners, deterministic UUID tie-break, and no user sees other validations.
  for (let i = 4; i < 16; i++) {
    const uid = `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    await db.query(`insert into profiles values($1,$2,'user',null)`, [
      uid,
      `leader-${i}`,
    ]);
    await seed(`RANK-${i}`, `NP-RANK-${i}`);
    await db.query(`update profiles set sponsor_id=$1 where id=$2`, [
      uid,
      buyer,
    ]);
    await validate(`RANK-${i}`, `NP-RANK-${i}`);
  }
  const board = await snapshot();
  assert.equal(board.winners.length, 10);
  assert.equal(board.winners[0].position, 1);
  assert.equal(board.winners[9].position, 10);
  assert.equal(board.validations.length, 0);
  assert.equal(
    board.winners.every(w => w.prize === "trip"),
    true
  );
  const raffleUser = "00000000-0000-0000-0000-000000000100";
  await db.query(`insert into profiles values($1,'sorteo','user',null)`, [
    raffleUser,
  ]);
  await db.query(`update profiles set sponsor_id=$1 where id=$2`, [
    raffleUser,
    buyer,
  ]);
  for (const [id, amount, eligible] of [
    ["RAFFLE-BASE", 9999.99, false],
    ["RAFFLE-MIN", 0.01, true],
    ["RAFFLE-UPPER", 4999.99, true],
    ["RAFFLE-TRIP", 0.01, false],
  ]) {
    await seed(id, `NP-${id}`, "2026-10-16T06:00:00Z", "confirmed", amount);
    await validate(id, `NP-${id}`, amount);
    assert.equal((await snapshot(raffleUser)).raffleEligible, eligible);
  }
  await db.exec(
    `update transactions set status='reversed' where id='RAFFLE-TRIP'`
  );
  assert.equal(Number((await snapshot(raffleUser)).total), 14999.99);
  assert.equal((await snapshot(raffleUser)).raffleEligible, true);
  assert.equal((await snapshot(raffleUser)).raffleDrawStatus, "pending");
  assert.equal((await snapshot(raffleUser)).raffleParticipants.length, 0);
  const adminBoard = await snapshot(admin, true);
  assert.equal(adminBoard.raffleParticipants[0].username, "sorteo");
  assert.equal(Number(adminBoard.raffleParticipantCount), 1);
  await assert.rejects(snapshot(raffleUser, true), /Administrador/);
  await validate("RAFFLE-BASE", "NP-RAFFLE-BASE", 9999.99, admin, true);
  assert.equal((await snapshot(raffleUser)).raffleEligible, false);
  console.log(
    "PASS: 10,000 inclusive / 15,000 exclusive raffle, trips-only top ten, privacy, pending draw, reversals/revocation, Mexico dates, funding, duplicates and audit."
  );
} finally {
  await db.close();
}
