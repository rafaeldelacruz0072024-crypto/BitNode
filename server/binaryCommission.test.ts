import { describe, expect, it } from "vitest";
import { BINARY_COMMISSION_RATE, binaryPairingStatus, calculateBinaryCommission, calculateMatchedVolume } from "./binaryCommission";

describe("binary commission rule", () => {
  it("uses ten percent of newly matched volume", () => {
    expect(BINARY_COMMISSION_RATE).toBe(0.10);
    expect(calculateMatchedVolume({ left: 100, right: 60 })).toBe(60);
    expect(calculateBinaryCommission({ left: 100, right: 60 })).toBe(6);
  });

  it("only pays the new matched delta", () => {
    expect(calculateMatchedVolume({ left: 120, right: 90, previouslyMatched: 50 })).toBe(40);
    expect(calculateBinaryCommission({ left: 120, right: 90, previouslyMatched: 50 })).toBe(4);
    expect(calculateMatchedVolume({ left: 120, right: 90, previouslyMatched: 100 })).toBe(0);
  });

  it("rounds binary payouts to eight decimal places", () => {
    expect(calculateBinaryCommission({ left: 12.34567891, right: 12.34567891 })).toBe(1.23456789);
  });

  it("reports pairing state and rejects invalid volumes", () => {
    expect(binaryPairingStatus(0, 0)).toBe("no_volume");
    expect(binaryPairingStatus(20, 0)).toBe("awaiting_pair");
    expect(binaryPairingStatus(20, 20)).toBe("paired");
    expect(() => calculateMatchedVolume({ left: -1, right: 2 })).toThrow("binary volumes must be non-negative");
  });
});
