import { afterEach, describe, expect, it } from "vitest";
import {
  addPendingDeposit,
  initialLocalUser,
  loadLocalUser,
  saveLocalUser,
  storageKeyForUser,
} from "./localUserStore";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

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
    const state = addPendingDeposit(
      { ...initialLocalUser, balance: 25 },
      movement
    );
    expect(state.balance).toBe(25);
    expect(state.movements[0]).toEqual(movement);
  });
});

describe("account-scoped local data", () => {
  it("never exposes one user's nodes to another user", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });

    saveLocalUser(
      {
        ...initialLocalUser,
        contracts: [
          {
            id: "NODE-A",
            name: "Nodo Diario",
            rate: "1% – 1.5%",
            amount: 100,
            status: "active",
            createdAt: "2026-08-30T00:00:00Z",
            duration: "Indefinida",
          },
        ],
      },
      "user-a"
    );

    expect(loadLocalUser("user-a").contracts).toHaveLength(1);
    expect(loadLocalUser("user-b").contracts).toEqual([]);
    expect(storageKeyForUser("user-a")).not.toBe(storageKeyForUser("user-b"));
  });
});
