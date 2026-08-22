import { describe, expect, it, vi } from "vitest";
import { activateConfirmedContract } from "./contractActivation";
import * as commissions from "./commissions";

describe("confirmed contract activation", () => {
  it("does not process commissions for pending contracts", async () => {
    const spy = vi.spyOn(commissions, "processContractCommissions");
    await expect(activateConfirmedContract({ sourceEventId: "evt-pending", contractId: "c-1", userId: "u-1", amount: 100, status: "pending" })).resolves.toEqual({ status: "skipped", reason: "contract is not confirmed" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("routes only confirmed contracts to the server-side commission adapter", async () => {
    const spy = vi.spyOn(commissions, "processContractCommissions").mockResolvedValue({ status: "processed", direct: 10, binary: 0, configuredDirectRate: 0.10, expectedDirectCommission: 10 });
    const result = await activateConfirmedContract({ sourceEventId: "evt-confirmed", contractId: "c-1", userId: "u-1", amount: 100, status: "confirmed" });
    expect(result).toMatchObject({ status: "processed", direct: 10, binary: 0 });
    expect(spy).toHaveBeenCalledOnce();
  });
});
