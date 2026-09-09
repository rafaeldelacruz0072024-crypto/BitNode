import { expect, it } from "vitest";
import { nodeProgress, type CycleReward } from "./nodeProgress";
const rows: CycleReward[] = [
  { contract_id: "finite", amount: "2.5", status: "pending", created_at: "2026-09-08T12:00:00Z" },
  { contract_id: "finite", amount: "9", status: "reversed", created_at: "2026-09-01T12:00:00Z" },
  { contract_id: "daily", amount: "1", status: "completed", created_at: "2026-09-01T12:00:00Z" },
  { contract_id: "daily", amount: "3", status: "completed", created_at: "2026-09-08T12:00:00Z" },
];
it("counts processed rewards per node, excluding reversed earnings", () => {
  expect(nodeProgress(rows, "finite", 7, 4, null)).toEqual({ days: 1, earnings: 2.5 });
  expect(nodeProgress(rows, "new", 7, 4, null)).toEqual({ days: 0, earnings: 0 });
});
it("resets both indicators without including previously paid daily rewards", () => {
  expect(nodeProgress(rows, "daily", null, 0, null)).toEqual({ days: 0, earnings: 0 });
  expect(nodeProgress(rows, "daily", null, 3, "2026-09-07T00:00:00Z")).toEqual({ days: 1, earnings: 3 });
  expect(nodeProgress(rows, "finite", 7, 0, null)).toEqual({ days: 0, earnings: 0 });
});
