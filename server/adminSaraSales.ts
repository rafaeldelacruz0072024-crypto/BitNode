import type { Express } from "express";
import { authenticatedAdmin } from "./adminWithdrawals.js";

export function registerAdminSaraSales(app: Express) {
  app.post("/api/admin/sara-sales/activate", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const admin = await authenticatedAdmin(req);
      if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
      const { userId, requestId, reason } = req.body || {};
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof userId !== "string" || !uuid.test(userId) || typeof requestId !== "string" || !uuid.test(requestId)
        || typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 500)
        return res.status(400).json({ error: "Selecciona un usuario y escribe un motivo de 5 a 500 caracteres." });
      const { data, error } = await admin.client.rpc("admin_activate_sara_ia", {
        p_admin_id: admin.userId, p_user_id: userId, p_request_id: requestId, p_reason: reason.trim(),
      });
      if (error) return res.status(error.code === "P0001" ? 409 : 503).json({ error: error.code === "P0001" ? error.message : "Activación manual no disponible. Verifica que la migración de SARA esté aplicada." });
      return res.json(data);
    } catch {
      return res.status(503).json({ error: "No se pudo activar SARA IA. Conserva la solicitud para reintentar." });
    }
  });
  app.get("/api/admin/sara-sales", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const admin = await authenticatedAdmin(req);
      if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
      // Stable pagination avoids silently reporting only the first API page.
      const all = async (table: string, columns: string, key: string) => {
        const rows: Record<string, any>[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await admin.client.from(table).select(columns).order(key).range(offset, offset + 499);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 500) return rows;
        }
      };
      const [payments, subscriptions, profiles, contracts, plans] = await Promise.all([
        all("sara_ia_payments", "order_id,user_id,price_amount,status,provider_status,pay_currency,provider_payment_id,actually_paid,created_at,completed_at", "order_id"),
        all("sara_ia_subscriptions", "user_id,paid_through_at", "user_id"),
        all("profiles", "id,username", "id"),
        all("contracts", "id,user_id,plan_id,status", "id"),
        all("plans", "id,duration_days,active", "id"),
      ]);
      const names = new Map(profiles.map(p => [p.id, p.username]));
      const eligiblePlans = new Set(plans.filter(p => p.active && Number(p.duration_days) === 21).map(p => p.id));
      const eligibleUsers = new Set(contracts.filter(c => c.status === "active" && eligiblePlans.has(c.plan_id)).map(c => c.user_id));
      const now = new Date().toISOString();
      return res.json({ generatedAt: now,
        eligibleUsers: profiles.filter(p => eligibleUsers.has(p.id)).map(p => ({ user_id: p.id, username: p.username || p.id })),
        payments: payments.map(p => ({ ...p, username: names.get(p.user_id) || p.user_id })),
        subscriptions: subscriptions.map(s => ({ ...s, username: names.get(s.user_id) || s.user_id,
          hasActive21DayNode: eligibleUsers.has(s.user_id) })),
      });
    } catch (error) {
      console.error("[admin-sara-sales]", error);
      return res.status(503).json({ error: "No se pudieron consultar las ventas de SARA IA. Verifica las tablas y los permisos del servidor." });
    }
  });
}
