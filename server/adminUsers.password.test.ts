import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), getUserById: vi.fn(), updateUserById: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: mocks.getUser, admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById } },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
}) }));
import handler from "../api/admin/users";

const id = "11111111-1111-1111-1111-111111111111";
function response() {
  const result = { code: 0, body: null as unknown, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; }, setHeader() {} };
  return result;
}
async function invoke(password: unknown, authorization = "Bearer operator") {
  const res = response();
  await handler({ method: "POST", headers: { authorization }, body: { userId: id, password } }, res);
  return res;
}
describe("admin user password update", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator", email: "gentecash@gmail.com" } }, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { id, app_metadata: {} } }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: "operator", role: "admin" }, error: null }).mockResolvedValueOnce({ data: { role: "user" }, error: null });
    mocks.updateUserById.mockResolvedValue({ error: null });
  });
  it("rejects missing authentication", async () => {
    expect((await invoke("strong-password-123", "")).code).toBe(401);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
  it("updates only the selected non-admin password", async () => {
    const result = await invoke("strong-password-123");
    expect(result.code).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledWith(id, { password: "strong-password-123" });
    expect(JSON.stringify(result.body)).not.toContain("strong-password-123");
  });
  it("rejects an administrator target", async () => {
    mocks.maybeSingle.mockReset().mockResolvedValueOnce({ data: { id: "operator", role: "admin" }, error: null }).mockResolvedValueOnce({ data: { role: "admin" }, error: null });
    expect((await invoke("strong-password-123")).code).toBe(403);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
  it("rejects an operator without the required identity", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator", email: "other@example.com" } }, error: null });
    expect((await invoke("strong-password-123")).code).toBe(403);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});
