import { describe, expect, it } from "vitest";
import { buildActivationReport, type ActivationTransaction } from "./activationReport";

const transaction = (overrides: Partial<ActivationTransaction>): ActivationTransaction => ({
  id: "", user_id: "user-1", username: "alice", type: "deposit", status: "completed",
  amount: 100, created_at: "2026-01-01T00:00:00Z", provider_status: null,
  provider_payment_id: null, ...overrides,
});

describe("activation report", () => {
  it("counts only completed contracts and verified prior payment sources", () => {
    const rows = [
      transaction({ id: "NP-paid", provider_payment_id: "payment-1", provider_status: "finished" }),
      transaction({ id: "promo-1", provider_status: "promo_cashback:NP-paid", amount: 5 }),
      transaction({ id: "contract-1", type: "contract", amount: -100, created_at: "2026-01-02T00:00:00Z" }),
      transaction({ id: "ADMIN-late", provider_status: "admin_manual:admin", created_at: "2026-01-03T00:00:00Z" }),
      transaction({ id: "contract-2", type: "contract", amount: -100, created_at: "2026-01-04T00:00:00Z" }),
      transaction({ id: "NP-pending", user_id: "user-2", status: "pending", provider_payment_id: "x", provider_status: "waiting" }),
    ];
    expect(buildActivationReport(rows)).toMatchObject([{ origin: "crypto", contracts: 2, cryptoDeposits: 100, manualDeposits: 0, activatedAmount: 200 }]);
  });

  it("distinguishes manual, mixed and unverified account funding", () => {
    const rows = [
      transaction({ id: "ADMIN-a", user_id: "manual", provider_status: "admin_manual:admin" }),
      transaction({ id: "NP-b", user_id: "mixed", provider_status: "confirmed", provider_payment_id: "payment-2" }),
      transaction({ id: "ADMIN-b", user_id: "mixed", provider_status: "admin_manual:admin" }),
      ...["manual", "mixed", "unknown"].map(id => transaction({ id: `contract-${id}`, user_id: id, type: "contract", amount: -50, created_at: "2026-01-02T00:00:00Z" })),
    ];
    const report = buildActivationReport(rows);
    expect(Object.fromEntries(report.map(row => [row.userId, row.origin]))).toEqual({ manual: "manual", mixed: "mixed", unknown: "unverified" });
  });
});
