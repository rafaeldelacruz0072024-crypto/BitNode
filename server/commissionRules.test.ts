import { describe, expect, it } from "vitest";
import { calculateDirectCommission, DIRECT_COMMISSION_RATE, isDirectCommissionRate } from "./commissionRules";

describe("direct commission rule", () => {
  it("uses exactly ten percent", () => {
    expect(DIRECT_COMMISSION_RATE).toBe(0.10);
    expect(calculateDirectCommission(100)).toBe(10);
    expect(isDirectCommissionRate(0.10)).toBe(true);
  });

  it("rounds to eight decimal places", () => {
    expect(calculateDirectCommission(12.34567891)).toBe(1.23456789);
  });

  it("rejects zero, negative and non-finite amounts", () => {
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateDirectCommission(amount)).toThrow("amount must be positive");
    }
  });

  it("does not accept another rate as direct", () => {
    expect(isDirectCommissionRate(0.09)).toBe(false);
    expect(isDirectCommissionRate(0.20)).toBe(false);
  });
});
