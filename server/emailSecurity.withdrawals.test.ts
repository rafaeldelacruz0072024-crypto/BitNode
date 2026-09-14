import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { registerEmailSecurityRoutes } from "./emailSecurity";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getUser: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc, from: mocks.from, auth: { getUser: mocks.getUser } }) }));
const handlers = new Map<string, (req: Request, res: Response) => Promise<unknown>>();
const id = "10000000-0000-0000-0000-000000000001";
const code = "123456";
const hash = () => crypto.createHmac("sha256", "test-secret").update(`${id}:${code}`).digest("hex");
let challenge: Record<string, unknown>;
let updates: ReturnType<typeof vi.fn>;
async function invoke(path: string, body: unknown) {
  let status = 200;
  let payload: any;
  const res = { status(n: number) { status = n; return this; }, json(value: unknown) { payload = value; return this; } };
  await handlers.get(`/api/security/email-code/${path}`)!({ body, header: () => "Bearer session" } as unknown as Request, res as unknown as Response);
  return { status, payload };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-key");
  vi.stubEnv("EMAIL_OTP_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner", email: "owner@example.test" } } });
  challenge = { id, purpose: "withdrawal", code_hash: hash(), consumed_at: null, attempts: 0, expires_at: new Date(Date.now()+600000).toISOString(), payload: { amount: 60, network: "BNB Chain", wallet: "0x0000000000000000000000000000000000000001" } };
  updates = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });
  mocks.from.mockImplementation(() => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: challenge }), update: updates };
    return q;
  });
  registerEmailSecurityRoutes({ post: (path: string, handler: any) => handlers.set(path, handler) } as unknown as Express);
});
afterEach(() => vi.unstubAllEnvs());
describe("email-verified withdrawal reservation", () => {
  it("blocks a closed window before creating a challenge or sending email", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "P0001", message: "La ventana de retiros está cerrada temporalmente." } });
    const result = await invoke("request", { purpose: "withdrawal", payload: challenge.payload });
    expect(result.status).toBe(423);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("validate_withdrawal_request", { p_user_id: "owner", p_amount: 60 });
  });
  it("fails closed when balance validation cannot reach the database", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "PGRST202", message: "missing function" } });
    expect((await invoke("request", { purpose: "withdrawal", payload: challenge.payload })).status).toBe(503);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rechecks the window and balance atomically and does not consume the code in JavaScript", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "P0001", message: "Saldo disponible insuficiente." } });
    expect((await invoke("verify", { challengeId: id, code })).status).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_verified_withdrawal", { p_user_id: "owner", p_challenge_id: id, p_code_hash: hash() });
    expect(updates).not.toHaveBeenCalled();
  });
  it("returns the canonical net amount and reserved balance", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "WDR-1", status: "pending", amount: 60, wallet: "test", fee: 3, netAmount: 57, balance: 40 } });
    const result = await invoke("verify", { challengeId: id, code, amount: 1 });
    expect(result.status).toBe(201);
    expect(result.payload).toMatchObject({ fee: 3, netAmount: 57, balance: 40 });
    expect(updates).not.toHaveBeenCalled();
  });
  it("lets the database resolve a retry of a consumed withdrawal without another reservation", async () => {
    challenge.consumed_at = new Date().toISOString();
    mocks.rpc.mockResolvedValue({ data: { id: "WDR-existing", amount: 60, wallet: "test", fee: 3, netAmount: 57, balance: 40 } });
    expect((await invoke("verify", { challengeId: id, code })).payload.id).toBe("WDR-existing");
    expect(updates).not.toHaveBeenCalled();
  });
  it("rejects a wrong OTP before the reservation RPC", async () => {
    expect((await invoke("verify", { challengeId: id, code: "999999" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(updates).toHaveBeenCalledWith({ attempts: 1 });
  });
});
