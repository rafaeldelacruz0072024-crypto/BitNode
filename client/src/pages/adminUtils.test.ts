import { describe, expect, it } from "vitest";
import { hasRows, matchesAdminSearch, userStatusLabel } from "./adminUtils";

describe("admin UI utilities", () => {
  it("matches a query across the visible administrative fields", () => {
    expect(matchesAdminSearch(["gentecash", "admin@example.com", "activo"], "ADMIN@EXAMPLE")).toBe(true);
    expect(matchesAdminSearch(["gentecash", "admin@example.com", "activo"], "pendiente")).toBe(false);
    expect(matchesAdminSearch(["gentecash"], "")).toBe(true);
  });

  it("derives user status from confirmation and active ban timestamps", () => {
    const now = Date.parse("2026-08-22T12:00:00Z");
    expect(userStatusLabel({ emailConfirmedAt: "2026-08-20T00:00:00Z" }, now)).toBe("activo");
    expect(userStatusLabel({ emailConfirmedAt: null }, now)).toBe("pendiente");
    expect(userStatusLabel({ emailConfirmedAt: "2026-08-20T00:00:00Z", bannedUntil: "2026-08-23T00:00:00Z" }, now)).toBe("suspendido");
  });

  it("distinguishes an empty dataset from a populated dataset", () => {
    expect(hasRows([])).toBe(false);
    expect(hasRows(undefined)).toBe(false);
    expect(hasRows([{ id: "row-1" }])).toBe(true);
  });
});
