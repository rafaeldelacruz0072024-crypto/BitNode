import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260926130331_remove_finite_capital_claim_restrictions.sql", "utf8");

it("decouples completed-node capital claims from ordinary withdrawal restrictions", () => {
  expect(migration).toContain("drop index if exists public.finite_node_one_claim_per_mexico_day");
  expect(migration).toContain("drop trigger if exists guard_user_capital_claim_block");
  const functionBody = migration.match(/create or replace function public\.choose_finite_node_capital[\s\S]*?revoke all on function/)?.[0] || "";
  expect(functionBody).not.toContain("type = 'withdraw'");
  expect(functionBody).not.toContain("Solo puedes solicitar 1 retiro por día");
  expect(functionBody).toContain("v_contract.status <> 'completed'");
  expect(functionBody).toContain("El capital de este nodo ya fue asignado");
  expect(functionBody).toContain("withdrawal_wallet_bep20");
});
