import { describe, expect, it } from "vitest";
import { validateWithdrawalInput, validWallet } from "./withdrawals";

describe("withdrawal validation", () => {
  it("accepts a valid Ethereum wallet", () => {
    expect(validWallet("Ethereum", "0x0000000000000000000000000000000000000001")).toBe(true);
  });

  it("rejects invalid wallet and below-minimum amounts", () => {
    expect(validateWithdrawalInput(10, "Ethereum", "invalid-wallet", 0)).toContain("wallet");
    expect(validateWithdrawalInput(9, "Ethereum", "0x0000000000000000000000000000000000000001", 0)).toContain("$10");
  });

  it("rejects a request over the daily limit", () => {
    expect(validateWithdrawalInput(100, "Ethereum", "0x0000000000000000000000000000000000000001", 950)).toContain("Límite diario");
  });
});
