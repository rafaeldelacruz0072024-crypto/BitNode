import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerAdminAccountView } from "./adminAccountView";
import { authenticatedAdmin } from "./adminWithdrawals";
vi.mock("./adminWithdrawals", () => ({ authenticatedAdmin: vi.fn() }));
describe("account support view", () => {
  let handler: any;
  let res: any;
  beforeEach(() => {
    vi.resetAllMocks();
    registerAdminAccountView({ post: (_: string, fn: any) => { handler = fn; } } as any);
    res = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  });
  it("rejects unauthenticated access", async () => {
    vi.mocked(authenticatedAdmin).mockResolvedValue({ error: "Sesión requerida.", status: 401 } as any);
    await handler({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("rejects non-admin access", async () => {
    vi.mocked(authenticatedAdmin).mockResolvedValue({ error: "Forbidden", status: 403 } as any);
    await handler({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it("rejects invalid target IDs before reading account data", async () => {
    const from = vi.fn();
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { from } } as any);
    await handler({ body: { userId: "invalid" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(from).not.toHaveBeenCalled();
  });
  it("does not disclose account data if auditing fails", async () => {
    const rpc = vi.fn();
    const from = vi.fn((table: string) => table === "profiles"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "target" } }) }) }) }
      : { insert: async () => ({ error: { message: "missing table" } }), upsert: async () => ({ error: { message: "unavailable" } }) });
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { from, rpc }, userId: "admin" } as any);
    await handler({ body: { userId: "075aab1e-5590-4885-8733-44692751e771" } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])("returns read-only snapshot with audited access (fallback=%s)", async fallback => {
    const insert = vi.fn().mockResolvedValue({ error: fallback ? { message: "missing table" } : null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const result = { data: [], error: null };
    const query: any = { eq: () => query, order: () => query, limit: async () => result,
      maybeSingle: async () => ({ data: { id: "target", username: "member" }, error: null }) };
    const from = vi.fn((table: string) => table === "admin_operation_audit_log"
      ? { insert } : table === "platform_settings" ? { upsert } : { select: () => query });
    const rpc = vi.fn().mockResolvedValue(result);
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { from, rpc }, userId: "admin", username: "operator" } as any);
    await handler({ body: { userId: "075aab1e-5590-4885-8733-44692751e771" } }, res);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ admin_id: "admin", action: "account_support_view" }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ operator: "operator", directs: [], contracts: [] }));
    if (fallback) expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ admin_id: "admin", target_id: "075aab1e-5590-4885-8733-44692751e771" }) }), { onConflict: "key" });
  });
});
