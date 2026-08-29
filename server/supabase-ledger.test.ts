import { describe, expect, it } from "vitest";
import { summarizeCompletedLedger } from "../client/src/lib/supabaseAdapter";
import type { Movement } from "../client/src/lib/localUserStore";

const movement = (id: string, type: Movement["type"], amount: number, status: Movement["status"] = "completed"): Movement => ({
  id,
  type,
  amount,
  status,
  label: id,
  date: "2026-08-29T00:00:00.000Z",
});

describe("Supabase transaction ledger", () => {
  it("reflects an administrative deposit in available balance", () => {
    expect(summarizeCompletedLedger([movement("ADMIN-1", "deposit", 100)])).toEqual({
      balance: 100,
      totalInvested: 0,
      totalYield: 0,
    });
  });

  it("subtracts node activation and ignores pending movements", () => {
    expect(summarizeCompletedLedger([
      movement("ADMIN-1", "deposit", 100),
      movement("NODE-1", "contract", -10),
      movement("PENDING-1", "withdraw", -50, "pending"),
      movement("YIELD-1", "yield", 1.25),
    ])).toEqual({ balance: 91.25, totalInvested: 10, totalYield: 1.25 });
  });
});
