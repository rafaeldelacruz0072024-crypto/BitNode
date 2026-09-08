import { describe, expect, it } from "vitest";
import { validateWithdrawalInput, validWallet } from "./withdrawals";

describe("withdrawal validation", () => {
  it("accepts a valid BNB Chain wallet", () => {
    expect(validWallet("BNB Chain", "0x0000000000000000000000000000000000000001")).toBe(true);
  });

  it("rejects invalid wallet and below-minimum amounts", () => {
    expect(validateWithdrawalInput(10, "BNB Chain", "invalid-wallet", 0)).toContain("wallet");
    expect(validateWithdrawalInput(9, "BNB Chain", "0x0000000000000000000000000000000000000001", 0)).toContain("$10");
  });

  it("rejects a request over the daily limit", () => {
    expect(validateWithdrawalInput(100, "BNB Chain", "0x0000000000000000000000000000000000000001", 950)).toContain("Límite diario");
  });
});
