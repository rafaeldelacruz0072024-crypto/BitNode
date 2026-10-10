import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedAdmin } from "./adminWithdrawals";
import { registerAdminSaraSales } from "./adminSaraSales";
vi.mock("./adminWithdrawals", () => ({ authenticatedAdmin: vi.fn() }));
describe("manual SARA activation", () => {
  let handler: any;
  let res: any;
  const userId = "00000000-0000-4000-8000-000000000001";
  const requestId = "00000000-0000-4000-8000-000000000002";
  beforeEach(() => {
    vi.resetAllMocks();
    registerAdminSaraSales({ get: vi.fn(), post: (_: string, fn: any) => { handler = fn; } } as any);
    res = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  });
  it.each([401,403])("rejects unauthorized (%s)", async status => {
    vi.mocked(authenticatedAdmin).mockResolvedValue({ error: "Denied", status } as any);
    await handler({ body: {} },res);
    expect(res.status).toHaveBeenCalledWith(status);
  });
  it("rejects invalid input without touching subscriptions", async () => {
    const rpc = vi.fn();
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { rpc }, userId: "admin" } as any);
    await handler({ body: { userId, requestId, reason: "x" } },res);
    expect(res.status).toHaveBeenCalledWith(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("uses verified actor and atomic RPC, never payment writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { paidThroughAt: "2030-01-01", replayed: false } });
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { rpc }, userId: "verified-admin" } as any);
    await handler({ body: { userId, requestId, reason: "Cortesía soporte", adminId: "forged" } },res);
    expect(rpc).toHaveBeenCalledWith("admin_activate_sara_ia", { p_admin_id: "verified-admin", p_user_id: userId, p_request_id: requestId, p_reason: "Cortesía soporte" });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ replayed:false }));
  });
  it.each([["P0001",409],["PGRST202",503]])("returns safe failure (%s)", async (code,status) => {
    const rpc = vi.fn().mockResolvedValue({ error: { code, message: "Requiere nodo de 21 días activo" } });
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { rpc }, userId: "admin" } as any);
    await handler({ body: { userId,requestId,reason:"Cortesía soporte" } },res);
    expect(res.status).toHaveBeenCalledWith(status);
  });
});
