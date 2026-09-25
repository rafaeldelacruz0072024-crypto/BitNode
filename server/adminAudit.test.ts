import { expect, it, vi } from "vitest";
import { recordAdminOperation } from "./adminAudit";

it("records the verified administrator and operation without secrets", async () => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  await recordAdminOperation({ from: () => ({ insert }) }, {
    adminId: "admin-1", adminEmail: "admin@example.com", adminUsername: "principal",
    action: "user_password_updated", targetType: "profile", targetId: "user-1",
  });
  expect(insert).toHaveBeenCalledWith({
    admin_id: "admin-1", admin_email: "admin@example.com", admin_username: "principal",
    action: "user_password_updated", target_type: "profile", target_id: "user-1", details: {},
  });
  expect(insert.mock.calls[0][0].details).toEqual({});
});

it("uses the existing settings store until the dedicated audit migration is available", async () => {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const client = { from: (table: string) => table === "admin_operation_audit_log"
    ? { insert: vi.fn().mockResolvedValue({ error: { code: "PGRST205", message: "missing" } }) }
    : { insert: vi.fn(), upsert } };
  await recordAdminOperation(client, { adminId: "admin-1", action: "withdrawal_approve", targetType: "transaction", targetId: "W-1" });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    key: expect.stringMatching(/^admin_audit:/),
    value: expect.objectContaining({ admin_id: "admin-1", action: "withdrawal_approve", target_id: "W-1" }),
  }), { onConflict: "key" });
});
