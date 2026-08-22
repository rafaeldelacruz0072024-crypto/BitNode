import { describe, expect, it } from "vitest";
import { addPendingDeposit, initialLocalUser } from "./localUserStore";

describe("pending deposits", () => {
  it("does not increase the available balance", () => {
    const movement = {
      id: "DEP-1",
      type: "deposit" as const,
      label: "Depósito manual · pendiente",
      amount: 100,
      status: "pending" as const,
      date: new Date().toISOString(),
    };
    const state = addPendingDeposit({ ...initialLocalUser, balance: 25 }, movement);
    expect(state.balance).toBe(25);
    expect(state.movements[0]).toEqual(movement);
  });
});
