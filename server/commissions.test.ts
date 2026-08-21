import { describe, expect, it } from "vitest";
import { activateContractAndCommissions, processConfirmedContractCommissions, processContractCommissionsWithClient, summarizeCommissionRows, validateCommissionEventInput } from "./commissions";

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

  it("rejects an invalid atomic activation before calling Supabase", async () => {
    const client = { rpc: async () => ({ data: null, error: null }) };
    await expect(activateContractAndCommissions(client as never, { userId: "user-1", contractId: "", label: "Nodo", amount: 10 })).rejects.toThrow("Invalid contract activation input");
  });

  it("handles parallel duplicate commission events idempotently", async () => {
    let calls = 0;
    const client = { rpc: async () => { calls += 1; return { data: calls === 1 ? { status: "credited" } : { status: "duplicate" }, error: null }; } };
    const results = await Promise.all(Array.from({ length: 12 }, () => processContractCommissionsWithClient(client as never, { sourceEventId: "event-1", contractId: "contract-1", userId: "user-1", amount: 100 })));
    expect(results.filter(result => result.status === "credited")).toHaveLength(1);
    expect(results.filter(result => result.status === "duplicate")).toHaveLength(11);
  });

  it("surfaces atomic activation RPC failures", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "Insufficient available balance" } }) };
    await expect(activateContractAndCommissions(client as never, { userId: "user-1", contractId: "contract-1", label: "Nodo", amount: 10 })).rejects.toThrow("Contract activation RPC failed");
  });

  it("rejects non-completed contract transactions before the RPC", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: "contract-1", user_id: "user-1", type: "contract", status: "pending", amount: -100 }, error: null }) }),
          }),
        }),
      }),
      rpc: async () => ({ data: { status: "credited" }, error: null }),
    };
    await expect(processConfirmedContractCommissions(client as never, "user-1", "contract-1")).rejects.toThrow("Only completed contract transactions");
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
