import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { registerAdminMonthlyRoiRoutes } from "./adminMonthlyRoi";
import { businessDaysInMonth, monthlyRoiInput } from "../shared/monthlyRoi";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("./adminWithdrawals", () => ({ authenticatedAdmin: auth }));
const servers: Server[] = [];
afterEach(() => { servers.forEach(server => server.close()); servers.length = 0; vi.resetAllMocks(); });
async function api(method = "GET", body?: unknown) {
  const app = express(); app.use(express.json()); registerAdminMonthlyRoiRoutes(app);
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  return fetch(`http://127.0.0.1:${port}/api/admin/monthly-roi?month=2026-09`, {
    method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const rates = { daily: 25, seven: 18, fourteen: 35, twentyOne: 55 };
describe("monthly ROI controls", () => {
  it("counts actual weekdays including leap February and months with 23 weekdays", () => {
    expect(businessDaysInMonth("2024-02")).toBe(21);
    expect(businessDaysInMonth("2026-07")).toBe(23);
    expect(businessDaysInMonth("2026-09")).toBe(22);
    expect(businessDaysInMonth("2026-13")).toBe(0);
  });
  it("accepts zero, rejects incomplete, negative, infinite and extra rates", () => {
    const input = { month: "2026-09", rates, version: 0 };
    expect(monthlyRoiInput.safeParse({ ...input, rates: { ...rates, daily: 0 } }).success).toBe(true);
    for (const daily of [-1, Infinity, NaN, 1001, 1.001, "25", null]) {
      expect(monthlyRoiInput.safeParse({ ...input, rates: { ...rates, daily } }).success).toBe(false);
    }
    expect(monthlyRoiInput.safeParse({ ...input, rates: { daily: 25 } }).success).toBe(false);
    expect(monthlyRoiInput.safeParse({ ...input, rates: { ...rates, commission: 10 } }).success).toBe(false);
  });
  it("denies unauthenticated reads and unauthorized writes", async () => {
    auth.mockResolvedValueOnce({ error: "Sesión requerida", status: 401 });
    expect((await api()).status).toBe(401);
    auth.mockResolvedValueOnce({ error: "No autorizado", status: 403 });
    expect((await api("PUT", { month: "2026-09", rates, version: 0 })).status).toBe(403);
  });
  it("rejects malformed rates without writing", async () => {
    const rpc = vi.fn(); auth.mockResolvedValue({ client: { rpc }, userId: "admin-id" });
    expect((await api("PUT", { month: "2026-09", rates: { ...rates, daily: -1 }, version: 0 })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("saves all rates atomically with server-verified identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rates, version: 1, updated_at: "2026-09-06" }, error: null });
    auth.mockResolvedValue({ client: { rpc }, userId: "admin-id" });
    const response = await api("PUT", { month: "2026-09", rates, version: 0 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ month: "2026-09", rates, version: 1 });
    expect(rpc).toHaveBeenCalledWith("save_monthly_node_roi", { p_month: "2026-09-01", p_rates: rates, p_expected_version: 0, p_actor: "admin-id" });
  });
  it("reports conflicts and migration failures without claiming success", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "40001" } }).mockResolvedValueOnce({ error: { code: "42883" } });
    auth.mockResolvedValue({ client: { rpc }, userId: "admin-id" });
    expect((await api("PUT", { month: "2026-09", rates, version: 1 })).status).toBe(409);
    expect((await api("PUT", { month: "2026-09", rates, version: 1 })).status).toBe(503);
  });
  it("loads saved rates after a reload and distinguishes an unconfigured month", async () => {
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: { rates, version: 2, updated_at: "2026-09-06" }, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    auth.mockResolvedValue({ client: { from: () => ({ select: () => ({ eq }) }) } });
    expect(await (await api()).json()).toMatchObject({ rates, version: 2 });
    expect(await (await api()).json()).toMatchObject({ rates: null, version: 0 });
    expect(eq).toHaveBeenCalledWith("month", "2026-09-01");
  });
});
