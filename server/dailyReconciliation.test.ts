import { expect, it } from "vitest";
import { buildDailyReconciliation, reconciliationDates } from "./dailyReconciliation";

it("keeps external cash, returned capital, credits and pending source buckets separate", () => {
  const base = { type: "deposit", status: "completed", amount: 100, net_amount: null, provider_status: null, provider_payment_id: null, created_at: "2026-09-16T15:00:00Z", direct_commission_spent: 0, weekly_bonus_spent: 0, node_roi_spent: 0 };
  const report = buildDailyReconciliation("2026-09-16", [
    { ...base, id: "NP-1", provider_payment_id: "payment-1", provider_status: "finished" },
    { ...base, id: "ADMIN-1", provider_status: "admin_manual:admin", amount: 20 },
    { ...base, id: "DAILY-CAPITAL-1", amount: 50 },
    { ...base, id: "cashback", provider_status: "promo_cashback:NP-1", amount: 5 },
    { ...base, id: "withdraw-1", type: "withdraw", status: "pending", amount: -40, net_amount: 38, direct_commission_spent: 10, weekly_bonus_spent: 20, node_roi_spent: 5 },
  ], [{ commission_type: "direct", amount: 7, status: "credited", created_at: base.created_at }], [{ id: "node-1", amount: 50, status: "cancelled", updated_at: base.created_at }]);
  expect(report.incoming).toMatchObject({ crypto: 100, manual: 20, capitalReturned: 50, other: 0 });
  expect(report.outstanding).toMatchObject({ gross: 40, net: 38, direct: 10, weekly: 20, nodeRoi: 5, unallocated: 5 });
  expect(report.commissions.direct).toBe(7);
  expect(report.cancelledNodes).toBe(1);
  expect(report.isWednesday).toBe(true);
});

it("accepts up to 31 consecutive days and rejects invalid ranges", () => {
  expect(reconciliationDates("2026-09-01", "2026-09-30")).toHaveLength(30);
  expect(reconciliationDates("2026-09-01", "2026-10-01")).toHaveLength(31);
  expect(reconciliationDates("2026-09-01", "2026-10-02")).toBeNull();
  expect(reconciliationDates("2026-09-17", "2026-09-16")).toBeNull();
  expect(reconciliationDates("2026-02-30", "2026-02-30")).toBeNull();
});
