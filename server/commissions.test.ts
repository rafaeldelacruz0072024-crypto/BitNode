import { beforeEach, describe, expect, it, vi } from "vitest";
import { processContractCommissions } from "./commissions";

beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  vi.restoreAllMocks();
});

describe("processContractCommissions", () => {
  it("passes a confirmed contract to the protected RPC", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "processed", direct: 10, binary: 0 }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await processContractCommissions({ sourceEventId: "evt-1", contractId: "contract-1", userId: "user-1", amount: 100 });
    expect(result).toMatchObject({ status: "processed", configuredDirectRate: 0.10, expectedDirectCommission: 10 });
    expect(fetchMock).toHaveBeenCalledWith("https://example.supabase.co/rest/v1/rpc/process_contract_commissions", expect.objectContaining({ method: "POST", body: expect.stringContaining('"p_amount":100') }));
  });

  it("preserves duplicate responses from the idempotent RPC", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "duplicate", direct: 0, binary: 0 }) }));
    await expect(processContractCommissions({ sourceEventId: "evt-duplicate", contractId: "contract-1", userId: "user-1", amount: 100 })).resolves.toMatchObject({ status: "duplicate" });
  });

  it("does not call Supabase for invalid amounts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(processContractCommissions({ sourceEventId: "evt-invalid", contractId: "contract-1", userId: "user-1", amount: 0 })).rejects.toThrow("amount must be positive");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
