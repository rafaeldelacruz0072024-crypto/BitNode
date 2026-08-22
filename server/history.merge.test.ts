import { describe, expect, it } from "vitest";
import { mergeTransactions } from "../client/src/lib/supabaseAdapter";
import type { Movement } from "../client/src/lib/localUserStore";

const movement = (id: string, label: string): Movement => ({ id, type: "deposit", label, amount: 10, status: "completed", date: "2026-08-21T00:00:00.000Z" });

describe("transaction history merge", () => {
  it("keeps remote precedence and removes duplicate IDs", () => {
    const result = mergeTransactions([movement("same", "local"), movement("local-only", "local only")], [movement("same", "remote"), movement("remote-only", "remote only")]);
    expect(result.map((item) => item.id)).toEqual(["same", "remote-only", "local-only"]);
    expect(result[0]?.label).toBe("remote");
  });
});
