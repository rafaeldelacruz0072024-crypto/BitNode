import type { Express } from "express";
import { authenticatedAdmin } from "./adminWithdrawals.js";
import { supportSubtree } from "./supportTree.js";

export function registerAdminAccountView(app: Express) {
  app.post("/api/admin/account-view", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const admin = await authenticatedAdmin(req);
      if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
      const userId = req.body?.userId;
      if (typeof userId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId))
        return res.status(400).json({ error: "Usuario inválido." });
      const { data: profile, error } = await admin.client.from("profiles")
        .select("id,username,sponsor_id").eq("id", userId).maybeSingle();
      if (error) throw error;
      if (!profile) return res.status(404).json({ error: "Usuario no encontrado." });
      // Fail closed: no account data is disclosed unless the access is audited.
      const audit = await admin.client.from("admin_operation_audit_log").insert({
        admin_id: admin.userId, admin_email: admin.email, admin_username: admin.username,
        action: "account_support_view", target_type: "profile", target_id: userId,
        details: { mode: "read_only" },
      });
      if (audit.error) {
        // Same fallback used by the audit panel, but still fail closed here.
        const fallback = await admin.client.from("platform_settings").upsert({
          key: `admin_audit:${crypto.randomUUID()}`,
          value: { admin_id: admin.userId, admin_email: admin.email, admin_username: admin.username,
            action: "account_support_view", target_type: "profile", target_id: userId, details: { mode: "read_only" } },
          updated_at: new Date().toISOString(),
        }, { onConflict: "key" });
        if (fallback.error) return res.status(503).json({ error: "No se pudo registrar el acceso en auditoría. No se abrió la cuenta." });
      }
      const all = async (build: () => any) => {
        const rows: any[] = [];
        // Empty-page termination also works if the server page cap is below 500.
        for (;;) {
          const { data, error } = await build().range(rows.length, rows.length + 499);
          if (error) throw error;
          if (!data?.length) return rows;
          rows.push(...data);
        }
      };
      const [network, directs, contracts] = await Promise.all([
        all(() => admin.client.from("network_nodes").select("user_id,parent_id,leg").order("user_id")),
        all(() => admin.client.from("profiles").select("id,username").eq("sponsor_id", userId).order("id")),
        all(() => admin.client.from("contracts").select("id,plan_id,amount,status").eq("user_id", userId).order("id")),
      ]);
      const nodes = supportSubtree(network, userId);
      for (let offset = 0; offset < nodes.length; offset += 100) {
        const ids = nodes.slice(offset, offset + 100).map(n => n.user_id);
        const names = await all(() => admin.client.from("profiles").select("id,username").in("id", ids).order("id"));
        const byId = new Map(names.map(p => [p.id, p.username]));
        for (const node of nodes.slice(offset, offset + 100)) node.username = byId.get(node.user_id) || "Usuario";
      }
      return res.json({ profile, nodes, directs, contracts, operator: admin.username || admin.email });
    } catch (error) {
      console.error("[admin-account-view]", error);
      return res.status(503).json({ error: "No se pudo cargar la vista de soporte." });
    }
  });
}
