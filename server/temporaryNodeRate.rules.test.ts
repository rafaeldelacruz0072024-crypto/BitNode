import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260928094304_temporary_lower_half_node_rates.sql", import.meta.url),
  "utf8",
);

describe("temporary lower-half node rate policy", () => {
  it("limits rates to the lower half only through Friday", () => {
    expect(migration).toContain("date ''2026-09-28''");
    expect(migration).toContain("date ''2026-10-02''");
    expect(migration).toContain("(v_contract.rate_max - v_contract.rate_min) / 2");
  });

  it("restores the full configured range automatically", () => {
    expect(migration).toContain(
      "else round((v_contract.rate_min + random() * (v_contract.rate_max - v_contract.rate_min))::numeric, 6)",
    );
  });

  it("refuses to remove the Monday-Friday guard", () => {
    expect(migration).toContain(
      "definition !~ 'extract\\(isodow[[:space:]]+from[[:space:]]+now\\(\\)\\)[[:space:]]+between[[:space:]]+1[[:space:]]+and[[:space:]]+5'",
    );
  });

  it("matches the stored rate assignment regardless of whitespace", () => {
    expect(migration).toContain(
      "rate_assignment_pattern constant text := 'v_rate[[:space:]]*:=[[:space:]]*[^;]+;'",
    );
    expect(migration).toContain("if assignment_count <> 1 then");
    expect(migration).not.toContain("Unknown node reward engine");
    expect(migration).not.toContain("temporary_expression constant text");
  });
});
