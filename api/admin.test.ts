import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./admin";

type MockResponse = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> };
function response(): MockResponse { const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() } as MockResponse; res.status.mockReturnValue(res); return res; }
function supabaseResponse(body: unknown, ok = true, status = 200) { return Promise.resolve({ ok, status, json: async () => body }); }

beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  vi.restoreAllMocks();
});

describe("native Vercel admin function with Supabase roles", () => {
  it("rejects a request without a Supabase session", async () => {
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "unauthenticated" }));
  });

  it("rejects an invalid Supabase token", async () => {
    vi.stubGlobal("fetch", vi.fn(() => supabaseResponse({}, false, 401)));
    const res = response();
    await handler({ method: "GET", headers: { authorization: "Bearer expired" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects an authenticated user without the admin role", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(supabaseResponse({ id: "user-1", email: "user@example.com" }))
      .mockResolvedValueOnce(supabaseResponse([{ id: "user-1", username: "member", role: "user" }])));
    const res = response();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-user" } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "forbidden" }));
  });

  it("allows an authenticated user with the admin role", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(supabaseResponse({ id: "admin-1", email: "admin@example.com" }))
      .mockResolvedValueOnce(supabaseResponse([{ id: "admin-1", username: "operator", role: "admin" }])));
    const res = response();
    await handler({ method: "GET", headers: { authorization: "Bearer valid-admin" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "ready", user: expect.objectContaining({ role: "admin" }) }));
  });

  it("rejects methods other than GET", async () => {
    const res = response();
    await handler({ method: "POST", headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
