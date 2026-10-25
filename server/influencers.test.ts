import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261023231902_influencer_program.sql", "utf8");
const plans = readFileSync("supabase/migrations/20261024001725_influencer_plan_catalog.sql", "utf8");
const completion = readFileSync("supabase/migrations/20261025113942_complete_influencer_program.sql", "utf8");
const route = readFileSync("server/influencers.ts", "utf8");

describe("programa Influencers", () => {
  it("mantiene límites sostenibles y evidencia privada", () => {
    expect(migration).toMatch(/price numeric\(18,2\).*default 100/);
    expect(migration).toMatch(/reward_rate numeric\(18,4\).*default 0\.01/);
    expect(plans).toContain("('starter','Starter',50,100,20,0.01,120,1)");
    expect(plans).toContain("('creator','Creator',100,200,40,0.01,120,2)");
    expect(plans).toContain("('pro','Pro',250,500,100,0.01,120,3)");
    expect(migration).toMatch(/reward_cap numeric\(18,2\).*default 200/);
    expect(migration).toMatch(/'influencer-evidence','influencer-evidence',false/);
  });

  it("compra, audita y acredita de forma atómica e idempotente", () => {
    expect(completion).toContain("purchase_influencer_plan_from_balance");
    expect(completion).toContain("pg_advisory_xact_lock");
    expect(completion).toContain("INFLUENCER-BUY-");
    expect(completion).toContain("admin_review_influencer_submission");
    expect(completion).toContain("settle_due_influencer_payouts");
    expect(completion).toContain("INFLUENCER-PAYOUT-");
    expect(completion).toContain("on conflict(id) do nothing");
    expect(completion).toContain("'deposit','withdraw','contract','yield','influencer'");
    expect(route).not.toMatch(/commission_ledger|network_volume|process_contract_commissions/);
  });

  it("exige paquete activo y limita tres historias", () => {
    expect(completion).toContain("status='active'");
    expect(completion).toContain("if v_count>=3");
    expect(completion).toContain("America/Mexico_City");
    expect(completion).toContain("p_verified_views>s.reported_views");
    expect(route).toContain("create_influencer_submission");
    expect(route).toContain("/api/influencers/purchase");
    expect(route).toContain("/api/admin/influencers/maintenance");
    expect(route).not.toContain("uploadToSignedUrl");
  });
});
