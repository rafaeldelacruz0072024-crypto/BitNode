import { describe, expect, it } from "vitest";
import { NODES_V2, nodeCycleProjection, nodeVersion } from "../shared/nodesV2";
describe("Nodos 2.0", () => {
  it.each([[0,50,70],[1,136,187],[2,429,693]])("calculates simple cycle ROI for plan %s", (index,min,max) => {
    expect(nodeCycleProjection(NODES_V2[index],1000)).toEqual({min,max});
  });
  it("does not reclassify legacy plans by their name or duration", () => {
    expect(["daily","7d","14d","21d",undefined].map(nodeVersion)).toEqual([1,1,1,1,1]);
    expect(NODES_V2.map(plan => nodeVersion(plan.id))).toEqual([2,2,2]);
  });
  it("does not compound earnings or accept invalid calculator input", () => {
    expect(nodeCycleProjection(NODES_V2[2],2000)).toEqual({min:858,max:1386});
    expect(nodeCycleProjection(NODES_V2[0],NaN)).toEqual({min:0,max:0});
  });
});

