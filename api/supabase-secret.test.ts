import { describe, expect, it } from "vitest";

describe("Supabase server secret", () => {
  it("authenticates against the profiles endpoint with service privileges", async () => {
    const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    expect(base).toMatch(/^https:\/\//);
    expect(key).toBeTruthy();

    let claims: { role?: string } = {};
    try { claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")); } catch { /* Secret keys may not be JWTs. */ }
    if (claims.role) expect(claims.role).toBe("service_role");

    const response = await fetch(`${base}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    expect(response.status).toBe(200);
  }, 15_000);
});
