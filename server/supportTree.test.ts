import { describe, it, expect } from "vitest";
import { supportSubtree, type SupportNode } from "./supportTree";
describe("uncapped support tree", () => {
  it("includes more than 25 levels and 1000 records, excludes unrelated branches", () => {
    const nodes: SupportNode[] = Array.from({ length: 1100 }, (_, i) => ({ user_id: String(i), parent_id: i ? String(i - 1) : null, leg: i ? "left" : null }));
    nodes.push({ user_id: "outside", parent_id: null, leg: null });
    expect(supportSubtree(nodes, "0")).toHaveLength(1100);
    expect(supportSubtree(nodes, "1000")).toHaveLength(100);
    expect(supportSubtree(nodes, "missing")).toEqual([]);
  });
  it("terminates cycles without repeating members", () => {
    expect(supportSubtree([{ user_id: "a", parent_id: "b", leg: "left" }, { user_id: "b", parent_id: "a", leg: "left" }], "a")).toHaveLength(2);
  });
});
