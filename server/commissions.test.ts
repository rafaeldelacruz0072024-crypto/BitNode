import { describe, expect, it } from "vitest";
import { processContractCommissionsWithClient, summarizeCommissionRows, validateCommissionEventInput } from "./commissions";

describe("commission helpers", () => {
  it("requires trusted event identifiers and a positive amount", () => {
    expect(
      validateCommissionEventInput({
        sourceEventId: "evt-1",
        contractId: "contract-1",
        userId: "user-1",
        amount: 100,
      }),
    ).toBe(true);

    expect(
      validateCommissionEventInput({
        sourceEventId: "evt-1",
        contractId: "contract-1",
        userId: "user-1",
        amount: 0,
      }),
    ).toBe(false);
  });

  it("returns the idempotent duplicate response from the RPC", async () => {
    const client = {
      rpc: async () => ({ data: { status: "duplicate" }, error: null }),
    };
    await expect(
      processContractCommissionsWithClient(client, {
        sourceEventId: "evt-replayed",
        contractId: "contract-1",
        userId: "user-1",
        amount: 100,
      }),
    ).resolves.toEqual({ status: "duplicate" });
  });

  it("surfaces RPC failures instead of silently crediting a bonus", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "permission denied" } }),
    };
    await expect(
      processContractCommissionsWithClient(client, {
        sourceEventId: "evt-error",
        contractId: "contract-1",
        userId: "user-1",
        amount: 100,
      }),
    ).rejects.toThrow("Commission RPC failed: permission denied");
  });

  it("summarizes only credited direct and binary ledger rows", () => {
    expect(
      summarizeCommissionRows([
        { commission_type: "direct", amount: "10.00", status: "credited" },
        { commission_type: "binary", amount: 8, status: "credited" },
        { commission_type: "direct", amount: 99, status: "pending" },
        { commission_type: "reversal", amount: -2, status: "credited" },
      ]),
    ).toEqual({ direct: 10, binary: 8, total: 18 });
  });
});
