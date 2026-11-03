import { beforeEach, describe, expect, it, vi } from "vitest";
import { NODES_V2 } from "../shared/nodesV2";
const state = vi.hoisted(() => ({ admin: true, enabled: false, rate: .005, auth: true }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: state.auth ? { id: "user" } : null }, error: null }) },
  from: (table: string) => ({ select: () => ({
    eq: () => ({
      single: async () => ({ data: { role: state.admin ? "admin" : "user" }, error: null }),
      maybeSingle: async () => ({ data: { value: { enabled: state.enabled } }, error: null }),
    }),
    in: async () => ({ data: NODES_V2.map((p,index) => ({ id:p.id, active:true, rate_min:index===0 ? state.rate : p.rateMin, rate_max:p.rateMax, duration_days:p.days, min_amount:p.min })), error:null }),
  }) }),
}) }));
import { registerNodesV2Routes } from "./nodesV2";
describe("Nodos 2.0 catalog access", () => {
  let handler: Function;
  beforeEach(() => {
    Object.assign(state, { admin:true, enabled:false, rate:.005, auth:true });
    process.env.SUPABASE_URL="https://example.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY="test";
    registerNodesV2Routes({ get: (_path: string, fn: Function) => { handler=fn; } } as never);
  });
  async function run(token="Bearer test") {
    let status=200; let body: any;
    const response={ setHeader:vi.fn(), status:(code: number)=>{ status=code; return response; }, json:(value: unknown)=>{ body=value; } };
    await handler({ header:()=>token },response);
    return { status,body };
  }
  it("requires a valid session", async () => {
    expect((await run("")).status).toBe(401);
    state.auth=false; expect((await run()).status).toBe(401);
  });
  it("keeps unreleased plans hidden from ordinary users", async () => {
    state.admin=false; expect((await run()).status).toBe(404);
  });
  it("lets administrators preview without enabling purchases", async () => {
    const {body}=await run(); expect(body.preview).toBe(true); expect(body.plans.every((p:any)=>!p.enabled)).toBe(true);
  });
  it("requires an explicit release and exact stored terms to enable a plan", async () => {
    state.admin=false; state.enabled=true; state.rate=.05;
    const {body}=await run(); expect(body.plans[0].enabled).toBe(false); expect(body.plans[1].enabled).toBe(true);
  });
});
