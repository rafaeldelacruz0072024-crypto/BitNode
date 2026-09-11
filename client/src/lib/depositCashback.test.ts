import { describe, expect, it } from "vitest";
import {
  DEPOSIT_CASHBACK_START,
  depositCashback,
  depositCashbackTransactionId,
} from "@shared/depositCashback";

describe("deposit cashback promotion", () => {
  it.each([
    [499.99, 0, 0],
    [500, 0.1, 50],
    [999.99, 0.1, 100],
    [1000, 0.2, 200],
    [1500, 0.2, 300],
  ])("calculates the tier for %s USDT", (deposit, rate, cashback) => {
    expect(depositCashback(deposit)).toEqual({ rate, amount: cashback });
  });
  it("creates one stable ledger id per source deposit", () => {
    expect(depositCashbackTransactionId("NP-123")).toBe("CASHBACK-NP-123");
    expect(DEPOSIT_CASHBACK_START).toBe(
      Date.parse("2026-09-11T00:00:00-04:00")
    );
  });
});
