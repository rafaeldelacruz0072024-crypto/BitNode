import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260928175554_apply_temporary_lower_half_node_rates_verified.sql", import.meta.url),
  "utf8",
);

describe("temporary lower-half node rate policy", () => {
  it("limits rates to the lower half only through Friday", () => {
    expect(migration).toContain("date '2026-09-28'");
    expect(migration).toContain("date '2026-10-02'");
    expect(migration).toContain("(v_contract.rate_max - v_contract.rate_min) / 2");
  });

  it("restores the full configured range automatically", () => {
    expect(migration).toContain(
      "else round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6)",
    );
  });

  it("refuses to remove the Monday-Friday guard", () => {
    expect(migration).toContain("strpos(fn, 'America/Santo_Domingo') = 0");
    expect(migration).toContain("strpos(fn, 'not between 1 and 5') = 0");
  });

  it("replaces only the verified production rate assignment", () => {
    expect(migration).toContain(
      "old_rate text := $old$v_rate := round(coalesce(bitnode_private.monthly_daily_rate",
    );
    expect(migration).toContain("if strpos(fn, old_rate) = 0 then");
    expect(migration).not.toContain("Unknown node reward engine");
    expect(migration).not.toContain("temporary_expression constant text");
    expect(migration).not.toContain("regexp_replace");
  });
});
