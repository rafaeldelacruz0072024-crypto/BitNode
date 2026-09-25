import { expect, it } from "vitest";
import { groupWeeklyReconciliation, type ReconciliationDay } from "./weeklyReconciliation";

const day = (date: string, crypto: number, manual = 0): ReconciliationDay => ({
  date,
  incoming: { crypto, manual, capitalReturned: 5, other: 1 },
  withdrawalRequests: { gross: 10 },
  commissions: { direct: 2, other: 3 },
  cancelledNodes: 1,
});

it("groups daily reconciliation rows into Monday-to-Sunday weekly totals", () => {
  const weeks = groupWeeklyReconciliation([
    day("2026-09-20", 100),
    day("2026-09-21", 200, 25),
    day("2026-09-22", 300, 50),
  ]);
  expect(weeks).toHaveLength(2);
  expect(weeks[0]).toMatchObject({ from: "2026-09-20", to: "2026-09-20", days: 1, incoming: { crypto: 100 } });
  expect(weeks[1]).toMatchObject({
    from: "2026-09-21", to: "2026-09-22", days: 2,
    incoming: { crypto: 500, manual: 75, capitalReturned: 10, other: 2 },
    withdrawalRequests: { gross: 20 }, commissions: { direct: 4, other: 6 }, cancelledNodes: 2,
  });
});
