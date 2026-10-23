import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261023231902_influencer_program.sql", "utf8");
const route = readFileSync("server/influencers.ts", "utf8");

describe("programa Influencers", () => {
  it("mantiene límites sostenibles y evidencia privada", () => {
    expect(migration).toMatch(/price numeric\(18,2\).*default 100/);
    expect(migration).toMatch(/reward_rate numeric\(18,4\).*default 0\.01/);
    expect(migration).toMatch(/weekly_cap numeric\(18,2\).*default 25/);
    expect(migration).toMatch(/reward_cap numeric\(18,2\).*default 200/);
    expect(migration).toMatch(/'influencer-evidence','influencer-evidence',false/);
  });

  it("audita de forma atómica y no acredita balance automáticamente", () => {
    expect(migration).toContain("for update;");
    expect(migration).toContain("admin_review_influencer_submission");
    expect(migration).not.toMatch(/insert into public\.transactions/i);
    expect(route).not.toMatch(/commission_ledger|network_volume|process_contract_commissions/);
  });

  it("exige paquete activo y limita tres historias", () => {
    expect(route).toContain('.eq("status", "active")');
    expect(route).toContain('(count || 0) >= 3');
    expect(route).not.toContain("uploadToSignedUrl");
  });
});
