import { describe, expect, it } from "vitest";

describe("NOWPayments credentials", () => {
  it("accepts the configured API key", async () => {
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    expect(apiKey, "NOWPAYMENTS_API_KEY must be configured").toBeTruthy();

    const response = await fetch("https://api-sandbox.nowpayments.io/v1/status", {
      headers: { "x-api-key": apiKey as string },
    });

    expect(response.ok, `NOWPayments status returned ${response.status}`).toBe(true);
  }, 20_000);
});
