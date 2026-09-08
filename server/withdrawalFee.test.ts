import { describe, expect, it } from "vitest";
import { withdrawalFee } from "../shared/withdrawalFee";

describe("withdrawal fee", () => {
  it("charges 5% with the existing 1 USDT minimum", () => {
    expect(withdrawalFee(10)).toBe(1);
    expect(withdrawalFee(20)).toBe(1);
    expect(withdrawalFee(100)).toBe(5);
    expect(withdrawalFee(1000)).toBe(50);
  });
  it("rounds the charged fee to cents", () => {
    expect(withdrawalFee(123.45)).toBe(6.17);
  });
});

