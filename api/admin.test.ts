import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./admin";

type MockResponse = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> };

function response(): MockResponse {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() } as MockResponse;
  res.status.mockReturnValue(res);
  return res;
}

describe("native Vercel admin function", () => {
  beforeEach(() => { delete process.env.ADMIN_API_KEY; });

  it("rejects access when the server credential is not configured", () => {
    const res = response();
    handler({ method: "GET", headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "locked" }));
  });

  it("rejects an invalid bearer token", () => {
    process.env.ADMIN_API_KEY = "test-secret";
    const res = response();
    handler({ method: "GET", headers: { authorization: "Bearer wrong" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("allows a valid bearer token in read-only scope", () => {
    process.env.ADMIN_API_KEY = "test-secret";
    const res = response();
    handler({ method: "GET", headers: { authorization: "Bearer test-secret" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: "ready", readOnly: true }));
  });

  it("rejects methods other than GET", () => {
    const res = response();
    handler({ method: "POST", headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: "Método no permitido" });
  });
});
