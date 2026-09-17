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
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 750, totalInvested: 100, totalYield: 25 }), { status: 200 }));
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
    expect(body).toEqual({ transactions: [], contracts: [], capitalChoices: [], capitalChoiceReady: true, ledger: { balance: 750, totalInvested: 100, totalYield: 25 } });
    const requestedUrls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(requestedUrls[1]).toContain("user_id=eq.auth-user-123");
    expect(requestedUrls[2]).toContain("user_id=eq.auth-user-123");
    expect(requestedUrls[3]).toContain("finite_node_capital_choices");
    expect(requestedUrls[3]).toContain("user_id=eq.auth-user-123");
    expect(requestedUrls[4]).toContain("rpc/get_account_ledger_summary");
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ p_user_id: "auth-user-123" });
  });

  it("keeps the account available while the capital-choice migration is pending", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "owner" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 0, totalInvested: 0, totalYield: 0 }), { status: 200 })));
    let statusCode = 0;
    let body: any;
    const response = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; }, setHeader() {} };
    await handler({ method: "GET", headers: { authorization: "Bearer valid-token" } }, response);
    expect(statusCode).toBe(200);
    expect(body.capitalChoiceReady).toBe(false);
    expect(body.capitalChoices).toEqual([]);
  });
});
