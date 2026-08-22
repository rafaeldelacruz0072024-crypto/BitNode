import { describe, expect, it, vi } from "vitest";
import handler from "./data";

function responseMock() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as any;
}

function jsonResponse(body: unknown, status = 200, count?: number) {
  const headers = count === undefined ? undefined : { "content-range": `0-${Math.max(0, count - 1)}/${count}` };
  return new Response(JSON.stringify(body), { status, headers });
}

describe("admin data endpoint", () => {
  it("rejects requests without an authenticated session", async () => {
    const res = responseMock();
    await handler({ method: "GET", headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "unauthenticated" }));
  });

  it("rejects an authenticated user without the admin role", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "user-1", email: "user@example.com" }));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "user-1", role: "user" }]));
    vi.stubGlobal("fetch", fetchMock);
    const res = responseMock();

    await handler({ method: "GET", headers: { authorization: "Bearer token" } } as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "forbidden" }));
  });

  it("returns real read-only datasets and aggregate metrics for an admin", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "admin-1", email: "admin@example.com" }));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "admin-1", username: "admin", role: "admin" }]));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "admin-1", username: "admin", role: "admin", created_at: "2026-08-22T00:00:00Z" }], 200, 1));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "tx-1", user_id: "admin-1", type: "contract", amount: "100", status: "confirmed", created_at: "2026-08-22T01:00:00Z" }], 200, 1));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "ledger-1", beneficiary_id: "admin-1", commission_type: "direct", amount: "10", rate: "0.1", status: "credited", created_at: "2026-08-22T02:00:00Z" }], 200, 1));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ user_id: "admin-1", leg: "left", volume: "100", matched_volume: "0" }, { user_id: "admin-1", leg: "right", volume: "60", matched_volume: "0" }], 200, 2));
    fetchMock.mockResolvedValueOnce(jsonResponse({ users: [{ id: "admin-1", email: "admin@example.com", created_at: "2026-08-22T00:00:00Z", last_sign_in_at: "2026-08-22T03:00:00Z" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = responseMock();

    await handler({ method: "GET", headers: { authorization: "Bearer token" } } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready",
      readOnly: true,
      metrics: expect.objectContaining({ users: 1, contracts: 1, contractVolume: 100, creditedCommissions: 10 }),
      binaryVolume: { left: 100, right: 60, matched: 60, status: "paired" },
      commissions: expect.objectContaining({ direct: 10, binary: 0, total: 10, configuredDirectRate: 0.1, configuredBinaryRate: 0.1 }),
    }));
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("returns a controlled 503 when a protected dataset cannot be queried", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "admin-1", email: "admin@example.com" }));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "admin-1", username: "admin", role: "admin" }]));
    fetchMock.mockRejectedValueOnce(new Error("network failure"));
    vi.stubGlobal("fetch", fetchMock);
    const res = responseMock();

    await handler({ method: "GET", headers: { authorization: "Bearer token" } } as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "unavailable" }));
  });
});
