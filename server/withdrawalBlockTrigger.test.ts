import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260923235929_fix_withdrawal_block_transaction_trigger.sql", import.meta.url),
  "utf8",
);

describe("per-user withdrawal block trigger", () => {
  it("branches by table before reading table-specific NEW fields", () => {
    expect(migration).toMatch(/if tg_table_name = 'transactions' then\s+if new\.type = 'withdraw'/);
    expect(migration).toMatch(/elsif tg_table_name = 'finite_node_capital_choices' then\s+if new\.action = 'claim'/);
    expect(migration).not.toContain("tg_table_name = 'transactions' and new.type");
    expect(migration).not.toContain("tg_table_name = 'finite_node_capital_choices' and new.action");
  });
});
