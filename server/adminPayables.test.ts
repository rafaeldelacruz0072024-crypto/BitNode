import { describe, expect, it } from "vitest";
import { orderWithdrawalQueue, payableWithdrawal } from "./adminPayables";
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
  it("places only the designated pending payable after its target without changing timestamps", () => {
    const anchor = { id: "WDR-target", created_at: "2026-10-28T12:00:00Z", status: "pending" };
    const regular = { id: "WDR-other", created_at: "2026-10-30T12:00:00Z", status: "pending" };
    const payable = payableWithdrawal({ ...row, queue_after_id: anchor.id, display_date: "2026-10-30" });
    expect(orderWithdrawalQueue([anchor, payable, regular]).map(item => item.id)).toEqual([regular.id, anchor.id, payable.id]);
    expect(payable.created_at).toBe(row.created_at);
    expect(payable.display_date).toBe("2026-10-30");
    expect(orderWithdrawalQueue([regular, payable]).map(item => item.id)).toEqual([payable.id, regular.id]);
  });
});
