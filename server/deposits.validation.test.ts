import { describe, expect, it } from "vitest";
import { validateManualDeposit } from "./deposits";

describe("manual deposit validation", () => {
  it("accepts the configured deposit range", () => {
    expect(validateManualDeposit(10)).toBeNull();
    expect(validateManualDeposit(100000)).toBeNull();
  });

  it("rejects invalid amounts without crediting anything", () => {
    expect(validateManualDeposit(9)).toContain("$10");
    expect(validateManualDeposit(100001)).toContain("$100,000");
    expect(validateManualDeposit(Number.NaN)).toContain("$10");
  });
});
