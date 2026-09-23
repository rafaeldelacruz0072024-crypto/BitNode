import { describe, expect, it } from "vitest";
import { withdrawalSource } from "../shared/withdrawalSource";

describe("withdrawalSource", () => {
  it("identifies direct commission withdrawals", () => {
    expect(withdrawalSource({ directCommissionSpent: 49 })).toEqual({ source: "direct", direct: 49, wednesday: 0 });
  });

  it("combines weekly bonus and node ROI into the Wednesday source", () => {
    expect(withdrawalSource({ weeklyBonusSpent: 20, nodeRoiSpent: 30 })).toEqual({ source: "wednesday", direct: 0, wednesday: 50 });
  });

  it("identifies mixed and historical unclassified withdrawals", () => {
    expect(withdrawalSource({ directCommissionSpent: 10, weeklyBonusSpent: 15 })).toMatchObject({ source: "mixed" });
    expect(withdrawalSource({})).toEqual({ source: "unclassified", direct: 0, wednesday: 0 });
  });
});
