import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedAdmin } from "./adminWithdrawals";
import { registerAdminSaraSales } from "./adminSaraSales";
vi.mock("./adminWithdrawals", () => ({ authenticatedAdmin: vi.fn() }));
describe("admin SARA sales", () => {
  let handler: any; let res: any;
  beforeEach(() => {
    vi.resetAllMocks();
    registerAdminSaraSales({ get: (_: string, fn: any) => { handler = fn; } } as any);
    res = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  });
  it.each([401, 403])("rejects unauthorized access (%s)", async status => {
    vi.mocked(authenticatedAdmin).mockResolvedValue({ error: "Denied", status } as any);
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(status);
  });
  it("loads sales and separates node eligibility from paid subscription", async () => {
    const datasets: Record<string, any[]> = {
      sara_ia_payments: [{ order_id: "sale", user_id: "u", status: "completed", price_amount: 25 }],
      sara_ia_subscriptions: [{ user_id: "u", paid_through_at: "2030-01-01" }],
      profiles: [{ id: "u", username: "member" }],
      contracts: [{ id: "c", user_id: "u", status: "active", plan_id: "p" }],
      plans: [{ id: "p", active: true, duration_days: 21 }],
    };
    const from = vi.fn((table: string) => ({ select: () => ({ order: () => ({ range: async () => ({ data: datasets[table], error: null }) }) }) }));
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { from } } as any);
    await handler({}, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      payments: [expect.objectContaining({ username: "member", price_amount: 25 })],
      subscriptions: [expect.objectContaining({ hasActive21DayNode: true })],
    }));
  });
  it("reports query failure instead of misleading zero sales", async () => {
    const from = () => ({ select: () => ({ order: () => ({ range: async () => ({ error: { message: "unavailable" } }) }) }) });
    vi.mocked(authenticatedAdmin).mockResolvedValue({ client: { from } } as any);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
    log.mockRestore();
  });
});
