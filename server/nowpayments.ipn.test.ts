import crypto from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { depositCashbackEntry, validDepositCurrency, validIpnSignature } from "./nowpayments";

function signature(body: Record<string, unknown>, secret: string) {
  const sorted = Object.keys(body).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = body[key];
    return result;
  }, {});
  return crypto.createHmac("sha512", secret).update(JSON.stringify(sorted)).digest("hex");
}

describe("NOWPayments IPN signature", () => {
  beforeEach(() => {
    process.env.NOWPAYMENTS_IPN_SECRET = "test-ipn-secret";
  });

  it("accepts a correctly sorted HMAC signature", () => {
    const body = { payment_status: "finished", order_id: "NP-1", payment_id: 123 };
    expect(validIpnSignature(body, signature(body, "test-ipn-secret"))).toBe(true);
  });

  it("rejects a tampered payload or signature", () => {
    const body = { payment_status: "finished", order_id: "NP-1" };
    const signed = signature(body, "test-ipn-secret");
    expect(validIpnSignature({ ...body, payment_status: "failed" }, signed)).toBe(false);
    expect(validIpnSignature(body, `${signed}0`)).toBe(false);
  });
});

describe("supported deposit networks", () => {
  it("accepts only USDT TRC20 and BEP20", () => {
    expect(validDepositCurrency("usdttrc20")).toBe("usdttrc20");
    expect(validDepositCurrency("usdtbsc")).toBe("usdtbsc");
    expect(validDepositCurrency("usdterc20")).toBeNull();
    expect(validDepositCurrency("btc")).toBeNull();
  });
});

describe("confirmed deposit cashback ledger entry", () => {
  const deposit = { id: "NP-1", user_id: "user-1", username: "cliente", amount: 500, network: "usdtbsc", created_at: "2026-09-11T04:00:00.000Z" };

  it("creates deterministic 10% and 20% credits", () => {
    expect(depositCashbackEntry(deposit)).toMatchObject({ id: "CASHBACK-NP-1", amount: 50, status: "completed" });
    expect(depositCashbackEntry({ ...deposit, amount: 1000 })).toMatchObject({ id: "CASHBACK-NP-1", amount: 200, label: "Cashback promocional 20%" });
  });

  it("does not credit deposits below the tier, before launch, or with invalid dates", () => {
    expect(depositCashbackEntry({ ...deposit, amount: 499.99 })).toBeNull();
    expect(depositCashbackEntry({ ...deposit, created_at: "2026-09-11T03:59:59.999Z" })).toBeNull();
    expect(depositCashbackEntry({ ...deposit, created_at: "invalid" })).toBeNull();
  });
});
