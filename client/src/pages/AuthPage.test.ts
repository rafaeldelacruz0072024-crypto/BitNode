import { describe, expect, it } from "vitest";
import { referralForSubmit, referralFromMetadata } from "./AuthPage";

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

  it("does not replay stored referral metadata during login", () => {
    expect(
      referralForSubmit("login", null, {
        sponsor_referral_code: "old-sponsor",
        preferred_leg: "left",
      })
    ).toBeNull();
  });

  it("keeps referral recovery for signup completion", () => {
    expect(
      referralForSubmit("signup", null, {
        sponsor_referral_code: "gentecash",
        preferred_leg: "right",
      })
    ).toEqual({ code: "gentecash", leg: "right" });
  });
});
