import { describe, expect, it } from "vitest";
import { pendingPayoutSummary } from "./adminWithdrawals";

describe("pendingPayoutSummary", () => {
  it("totals only pending and approved withdrawals using the actual net payout", () => {
    expect(pendingPayoutSummary([
      { status: "pending", amount: -100, fee: 5, net_amount: 95 },
      { status: "approved", amount: "50", fee: "2.5", net_amount: "47.5" },
      { status: "completed", amount: -80, fee: 4, net_amount: 76 },
      { status: "rejected", amount: -20, fee: 1, net_amount: 19 },
    ])).toEqual({ count: 2, pending: 1, approved: 1, gross: 150, fees: 7.5, net: 142.5 });
  });

  it("falls back to gross minus fee when net amount is absent", () => {
    expect(pendingPayoutSummary([
      { status: "pending", amount: -25, fee: 1.25, net_amount: null },
    ])).toEqual({ count: 1, pending: 1, approved: 0, gross: 25, fees: 1.25, net: 23.75 });
  });
});
