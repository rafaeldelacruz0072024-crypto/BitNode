import { afterEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./supabaseClient", () => ({ supabase: { auth: session } }));
import { activateContractAndCommissions } from "./commissionsClient";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("activation using account balance", () => {
  const input = { contractId: "NODE-request", planId: "daily", amount: 100 };
  it("requires a session before sending the request", async () => {
    session.getSession.mockResolvedValue({ data: { session: null } });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(activateContractAndCommissions(input)).rejects.toThrow("Inicia sesión");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the same contract identifier on retry and accepts duplicate responses", async () => {
    session.getSession.mockResolvedValue({ data: { session: { access_token: "test" } } });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "duplicate", contract_id: input.contractId }) });
    vi.stubGlobal("fetch", fetcher);
    await activateContractAndCommissions(input);
    await expect(activateContractAndCommissions(input)).resolves.toMatchObject({ status: "duplicate" });
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe("/api/contracts/activate");
      expect(JSON.parse(options.body)).toEqual(input);
      expect(options.headers.Authorization).toBe("Bearer test");
    }
  });
  it("surfaces insufficient available balance without reporting success", async () => {
    session.getSession.mockResolvedValue({ data: { session: { access_token: "test" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Saldo disponible insuficiente" }) }));
    await expect(activateContractAndCommissions(input)).rejects.toThrow("Saldo disponible insuficiente");
  });
});
