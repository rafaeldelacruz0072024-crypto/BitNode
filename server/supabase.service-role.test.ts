import { describe, expect, it } from "vitest";

describe("Supabase service role credential", () => {
  it("can read the transactions table server-side", async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(url, "VITE_SUPABASE_URL must be configured").toBeTruthy();
    expect(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY must be configured").toBeTruthy();

    const response = await fetch(`${url}/rest/v1/transactions?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey as string,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    expect(response.ok, `Supabase returned ${response.status}`).toBe(true);
  }, 20_000);
});
