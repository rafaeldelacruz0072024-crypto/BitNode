import { describe, expect, it } from "vitest";
import { calculateAdminNetworkMetrics } from "./adminNetworkMetrics";

describe("admin commission network metrics", () => {
  it("separates direct and indirect referrals and sums the complete team volume", () => {
    const metrics = calculateAdminNetworkMetrics([
      { id: "root" },
      { id: "direct-a", sponsor_id: "root" },
      { id: "direct-b", sponsor_id: "root" },
      { id: "indirect", sponsor_id: "direct-a" },
    ], [
      { user_id: "root", amount: -50, status: "completed" },
      { user_id: "direct-a", amount: -100, status: "completed" },
      { user_id: "direct-b", amount: "-200", status: "pending" },
      { user_id: "indirect", amount: -300, status: "completed" },
      { user_id: "indirect", amount: 999, status: "failed" },
    ]);

    expect(metrics.find(row => row.userId === "root")).toEqual({
      userId: "root",
      directCount: 2,
      indirectCount: 1,
      networkCount: 3,
      personalVolume: 50,
      networkVolume: 600,
      organizationVolume: 650,
    });
    expect(metrics.find(row => row.userId === "direct-a")).toMatchObject({
      directCount: 1,
      indirectCount: 0,
      networkVolume: 300,
    });
  });

  it("does not loop forever when legacy sponsorship data contains a cycle", () => {
    const metrics = calculateAdminNetworkMetrics([
      { id: "a", sponsor_id: "b" },
      { id: "b", sponsor_id: "a" },
    ], [{ user_id: "b", amount: 25, status: "completed" }]);
    expect(metrics.find(row => row.userId === "a")).toMatchObject({ networkCount: 1, networkVolume: 25 });
  });
});
