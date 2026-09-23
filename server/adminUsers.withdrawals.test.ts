import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), profileMaybeSingle: vi.fn(), upsert: vi.fn(), deleteEq: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: mocks.getUser, admin: {} },
  from: (table: string) => table === "profiles"
    ? { select: () => ({ eq: () => ({ maybeSingle: mocks.profileMaybeSingle }) }) }
    : { upsert: mocks.upsert, delete: () => ({ eq: mocks.deleteEq }) },
}) }));

import handler from "../api/admin/users";

const userId = "11111111-1111-1111-1111-111111111111";
function response() {
  return { code: 0, body: null as unknown, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; }, setHeader() {} };
}
async function invoke(withdrawalBlocked: boolean) {
  const res = response();
  await handler({ method: "PUT", headers: { authorization: "Bearer operator" }, body: { userId, withdrawalBlocked, reason: "Revisión administrativa" } }, res);
  return res;
}

describe("admin per-user withdrawal control", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator", email: "gentecash@gmail.com" } }, error: null });
    mocks.profileMaybeSingle.mockResolvedValueOnce({ data: { id: "operator", role: "admin" }, error: null }).mockResolvedValueOnce({ data: { role: "user" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.deleteEq.mockResolvedValue({ error: null });
  });

  it("stores a withdrawal block with the operator and reason", async () => {
    const result = await invoke(true);
    expect(result.code).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: userId, blocked_by: "operator", reason: "Revisión administrativa",
    }), { onConflict: "user_id" });
  });

  it("removes the restriction when withdrawals are enabled", async () => {
    const result = await invoke(false);
    expect(result.code).toBe(200);
    expect(mocks.deleteEq).toHaveBeenCalledWith("user_id", userId);
  });

  it("does not allow blocking an administrator", async () => {
    mocks.profileMaybeSingle.mockReset().mockResolvedValueOnce({ data: { id: "operator", role: "admin" }, error: null }).mockResolvedValueOnce({ data: { role: "admin" }, error: null });
    expect((await invoke(true)).code).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
