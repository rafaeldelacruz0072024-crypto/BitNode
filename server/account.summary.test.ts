import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/account/summary";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("account summary ownership", () => {
  it("filters transactions and contracts with the authenticated user id", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "auth-user-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    let statusCode = 0;
    let body: unknown;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
      },
      setHeader() {},
    };

    await handler(
      { method: "GET", headers: { authorization: "Bearer valid-token" } },
      response,
    );

    expect(statusCode).toBe(200);
    expect(body).toEqual({ transactions: [], contracts: [] });
    const requestedUrls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(requestedUrls[1]).toContain("user_id=eq.auth-user-123");
    expect(requestedUrls[2]).toContain("user_id=eq.auth-user-123");
  });
});
