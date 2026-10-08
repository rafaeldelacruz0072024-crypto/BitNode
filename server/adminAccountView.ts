import type { Express } from "express";
import { authenticatedAdmin } from "./adminWithdrawals.js";

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
      const [tree, directs, contracts] = await Promise.all([
        admin.client.rpc("get_my_network_tree", { p_user_id: userId, p_max_depth: 25 }),
        admin.client.from("profiles").select("id,username").eq("sponsor_id", userId).order("id").limit(1000),
        admin.client.from("contracts").select("id,plan_id,amount,status").eq("user_id", userId).order("id").limit(1000),
      ]);
      if (tree.error || directs.error || contracts.error) {
        console.error("[admin-account-view] queries", { tree: tree.error, directs: directs.error, contracts: contracts.error });
        return res.status(503).json({ error: tree.error ? "No se pudo consultar el árbol del usuario. Verifica get_my_network_tree en Supabase." : "No se pudieron consultar los referidos o nodos del usuario." });
      }
      return res.json({ profile, nodes: tree.data || [], directs: directs.data || [], contracts: contracts.data || [],
        operator: admin.username || admin.email, depthLimit: 25, rowLimit: 1000 });
    } catch (error) {
      console.error("[admin-account-view]", error);
      return res.status(503).json({ error: "No se pudo cargar la vista de soporte." });
    }
  });
}
