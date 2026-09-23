import { describe, expect, it } from "vitest";
import { classifyNodeTaskCycles } from "./adminNodeControl";

const contract = (id: string, user_id: string, status = "active") => ({
  id, user_id, status, plan_id: "plan-1", amount: 100,
  starts_at: "2026-09-20T00:00:00Z", ends_at: null,
  created_at: "2026-09-20T00:00:00Z",
});
const cycle = (user_id: string, deadline_at: string, completed_tasks: string[]) => ({
  user_id, deadline_at, completed_tasks, cycle_day: 2,
  window_started_at: "2026-09-22T00:00:00Z", last_completed_at: null,
});

describe("classifyNodeTaskCycles", () => {
  const now = new Date("2026-09-23T12:00:00Z").getTime();

  it("marks an incomplete expired window as pending reset", () => {
    const result = classifyNodeTaskCycles(
      [contract("contract-1", "user-1")],
      [cycle("user-1", "2026-09-23T11:59:59Z", ["task-1", "task-2"])],
      now,
    );
    expect(result.pendingReset.map(row => row.id)).toEqual(["contract-1"]);
    expect(result.complying).toHaveLength(0);
  });

  it("keeps an active incomplete window in compliance before its deadline", () => {
    const result = classifyNodeTaskCycles(
      [contract("contract-2", "user-2")],
      [cycle("user-2", "2026-09-23T12:00:01Z", ["task-1"])],
      now,
    );
    expect(result.pendingReset).toHaveLength(0);
    expect(result.complying.map(row => row.id)).toEqual(["contract-2"]);
  });

  it("does not flag completed task windows for reset", () => {
    const result = classifyNodeTaskCycles(
      [contract("contract-3", "user-3")],
      [cycle("user-3", "2026-09-23T11:00:00Z", ["1", "2", "3", "4"])],
      now,
    );
    expect(result.pendingReset).toHaveLength(0);
  });
});
