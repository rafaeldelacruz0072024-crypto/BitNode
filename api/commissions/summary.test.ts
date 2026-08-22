import { describe, expect, it, vi } from "vitest";
import handler from "./summary";

function responseMock() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
}

describe("binary commission summary endpoint", () => {
  it("rejects requests without a Supabase session", async () => {
    const res = responseMock();
    await handler({ method: "GET", headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Sesión Supabase requerida." });
  });

  it("rejects authenticated users without admin role", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "user-1", email: "user@example.com" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "user" }] }));
    const res = responseMock();
    await handler({ method: "GET", headers: { authorization: "Bearer token" } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns the protected binary summary at ten percent", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "admin-1", email: "admin@example.com" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ role: "admin" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ commission_type: "binary", amount: "6", status: "credited" }, { commission_type: "direct", amount: "10", status: "credited" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ leg: "left", volume: "100" }, { leg: "right", volume: "60" }] }));
    const res = responseMock();
    await handler({ method: "GET", headers: { authorization: "Bearer token" } } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ configuredRate: 0.10, direct: 10, binary: 6, binaryVolume: { left: 100, right: 60, matched: 60, status: "paired" } }));
  });
});
