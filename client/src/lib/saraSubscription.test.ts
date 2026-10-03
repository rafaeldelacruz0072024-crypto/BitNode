import { describe, expect, it } from "vitest";
import { saraDaysRemaining } from "./saraSubscription";
describe("SARA calendar-day countdown", () => {
  const now = Date.parse("2026-10-05T12:00:00-04:00");
  it.each([
    [null, null], ["invalid", null],
    ["2026-11-04T12:00:00-04:00", 30],
    ["2026-10-06T12:00:00-04:00", 1],
    ["2026-10-05T12:00:01-04:00", 1],
    ["2026-10-05T12:00:00-04:00", 0],
    ["2026-10-04T12:00:00-04:00", 0],
    ["2026-12-04T12:00:00-04:00", 60],
  ])("counts remaining days for %s", (expiry, expected) => {
    expect(saraDaysRemaining(expiry, now)).toBe(expected);
  });
});
