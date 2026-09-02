import { describe, expect, it } from "vitest";
import { referralFromMetadata } from "./AuthPage";

describe("referral recovery", () => {
  it("restores the sponsor and preferred leg after email confirmation", () => {
    expect(
      referralFromMetadata({
        sponsor_referral_code: "gentecash",
        preferred_leg: "right",
      })
    ).toEqual({ code: "gentecash", leg: "right" });
  });

  it("rejects incomplete or invalid referral metadata", () => {
    expect(referralFromMetadata({ sponsor_referral_code: "gentecash" })).toBeNull();
    expect(
      referralFromMetadata({
        sponsor_referral_code: "gentecash",
        preferred_leg: "center",
      })
    ).toBeNull();
  });
});
