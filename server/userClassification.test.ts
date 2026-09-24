import { describe, it, expect } from "vitest";
import { classifyUsers } from "./userClassification";
describe("automatic user classification", () => {
  const manual = { id: "ADMIN-1", user_id: "u", type: "deposit", status: "completed", amount: 10, provider_status: "admin_manual:a" };
  const crypto = { ...manual, id: "NP-1", provider_status: "finished", provider_payment_id: "payment" };
  it("allows all labels from independent sources", () => {
    expect([...classifyUsers([manual, crypto], [{ user_id: "u", source_deposit_id: "ADMIN-corp" }]).get("u")!]).toEqual(["ADM (CORPORATIVA)", "REALES MANUAL", "CRYPTO"]);
  });
  it("does not call corporate funding real manual money", () => {
    expect([...classifyUsers([manual], [{ user_id: "u", source_deposit_id: manual.id }]).get("u")!]).toEqual(["ADM (CORPORATIVA)"]);
  });
  it("ignores pending, negative, unverified and internal credits", () => {
    expect(classifyUsers([{ ...manual, status: "pending" }, { ...manual, amount: -10 }, { ...crypto, provider_payment_id: null }, { ...manual, id: "CASHBACK-1" }], []).size).toBe(0);
  });
  it("deduplicates labels and separates users", () => {
    const result = classifyUsers([manual, manual, { ...crypto, user_id: "v" }], []);
    expect([...result.get("u")!]).toEqual(["REALES MANUAL"]);
    expect([...result.get("v")!]).toEqual(["CRYPTO"]);
    expect(result.has("new-user")).toBe(false);
  });
});
