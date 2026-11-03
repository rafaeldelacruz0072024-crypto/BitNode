import { describe, expect, it } from "vitest";
import { payableWithdrawal } from "./adminPayables";
import { pendingPayoutSummary } from "./adminWithdrawals";

describe("administrative payable queue", () => {
  const row = { id: "example", username: "recipient", amount: "326.32", fee: "16.32", net_amount: "310.00", wallet: "0x" + "1".repeat(40), network: "BNB Chain", status: "pending", created_at: "2026-11-03T12:00:00Z" };
  it("keeps the net obligation without attributing it to user commissions", () => {
    const result = payableWithdrawal(row);
    expect(result).toMatchObject({ id: "PAYABLE-example", amount: -326.32, net_amount: "310.00", user_id: null, direct_commission_spent: 0, weekly_bonus_spent: 0, node_roi_spent: 0, origin_label: "Retiro" });
    expect(pendingPayoutSummary([result])).toMatchObject({ count: 1, net: 310, fees: 16.32 });
  });
  it("removes paid or rejected obligations from the pending total", () => {
    expect(pendingPayoutSummary([payableWithdrawal({ ...row, status: "completed" }), payableWithdrawal({ ...row, status: "rejected" })]).net).toBe(0);
  });
  it("uses the administrative label without creating commissions or changing the payable", () => {
    expect(payableWithdrawal({ ...row, display_label: "Comisiones del miércoles", sponsor_id: "sponsor" }))
      .toMatchObject({ origin_label: "Comisiones del miércoles", sponsor_id: "sponsor", net_amount: "310.00", direct_commission_spent: 0, weekly_bonus_spent: 0 });
  });
});
