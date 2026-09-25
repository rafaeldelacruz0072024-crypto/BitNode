type AuditClient = {
  from: (table: string) => {
    insert: (value: Record<string, unknown>) => PromiseLike<{ error?: { message?: string; code?: string } | null }>;
    upsert?: (value: Record<string, unknown>, options?: { onConflict?: string }) => PromiseLike<{ error?: { message?: string } | null }>;
  };
};

export type AdminAuditEntry = {
  adminId: string;
  adminEmail?: string | null;
  adminUsername?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
};

export async function recordAdminOperation(client: AuditClient, entry: AdminAuditEntry) {
  try {
    if (!client || typeof client.from !== "function") return;
    const table = client.from("admin_operation_audit_log");
    if (!table || typeof table.insert !== "function") return;
    const value = {
      admin_id: entry.adminId,
      admin_email: entry.adminEmail || null,
      admin_username: entry.adminUsername || null,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId || null,
      details: entry.details || {},
    };
    const { error } = await table.insert(value);
    if (!error) return;
    const fallback = client.from("platform_settings");
    if (typeof fallback.upsert !== "function") return console.error("[admin-audit]", error.message || error);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const result = await fallback.upsert({ key: `admin_audit:${suffix}`, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (result.error) console.error("[admin-audit-fallback]", result.error.message || result.error);
  } catch (error) {
    // Administrative actions remain available if the audit migration has not reached an environment yet.
    console.error("[admin-audit]", error);
  }
}
