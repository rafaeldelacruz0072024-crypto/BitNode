import { describe, expect, it, vi } from "vitest";
import { processSaraIaIpn } from "./saraIa";

function paymentAdmin(payment: Record<string, unknown>) {
  const update = vi.fn(() => ({
    eq: () => ({ eq: async () => ({ error: null }) }),
  }));
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: payment, error: null }),
        }),
      }),
      update,
    }),
    rpc: vi.fn(async () => ({ data: { status: "completed" }, error: null })),
  };
  return { admin, update };
}

describe("SARA IA NOWPayments IPN", () => {
  const payment = {
    order_id: "SARA-order-1",
    provider_payment_id: "provider-1",
    pay_currency: "usdtbsc",
    status: "pending",
  };

  it("leaves unrelated orders to the deposit IPN handler", async () => {
    const { admin } = paymentAdmin(payment);
    await expect(
      processSaraIaIpn(admin as never, { order_id: "NP-deposit-1" })
    ).resolves.toEqual({ handled: false });
  });

  it("extends the subscription only for a finished, exact $25 USD payment on its requested network", async () => {
    const { admin } = paymentAdmin(payment);
    const result = await processSaraIaIpn(admin as never, {
      order_id: "SARA-order-1",
      payment_id: "provider-1",
      payment_status: "finished",
      price_amount: "25.00",
      price_currency: "USD",
      pay_currency: "usdtbsc",
      actually_paid: "25.01",
    });
    expect(result).toEqual({ handled: true, ok: true });
    expect(admin.rpc).toHaveBeenCalledWith(
      "complete_sara_ia_payment",
      expect.objectContaining({
        p_payment_id: "provider-1",
        p_price_amount: 25,
        p_pay_currency: "usdtbsc",
      })
    );
  });

  it("routes mismatched payment amount to review without extending the term", async () => {
    const { admin, update } = paymentAdmin(payment);
    const result = await processSaraIaIpn(admin as never, {
      order_id: "SARA-order-1",
      payment_id: "provider-1",
      payment_status: "finished",
      price_amount: "24.00",
      price_currency: "USD",
      pay_currency: "usdtbsc",
      actually_paid: "24",
    });
    expect(result).toEqual({ handled: true, ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "review" })
    );
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("does not activate on confirmation alone", async () => {
    const { admin } = paymentAdmin(payment);
    const result = await processSaraIaIpn(admin as never, {
      order_id: "SARA-order-1",
      payment_id: "provider-1",
      payment_status: "confirmed",
    });
    expect(result).toEqual({ handled: true, ok: true });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
