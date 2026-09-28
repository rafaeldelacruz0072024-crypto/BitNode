import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260928093513_pay_minimum_configured_node_rates.sql", "utf8");

it("replaces variable and monthly node rates with the configured minimum", () => {
  expect(migration).toContain("v_rate := v_contract.rate_min;");
  expect(migration).toContain("position(monthly_expression in definition)");
  expect(migration).toContain("position(random_expression in definition)");
  expect(migration).toContain("Minimum-rate policy was not installed cleanly");
});
