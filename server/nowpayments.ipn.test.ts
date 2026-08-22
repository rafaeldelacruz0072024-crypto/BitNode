import crypto from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { validIpnSignature } from "./nowpayments";

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
