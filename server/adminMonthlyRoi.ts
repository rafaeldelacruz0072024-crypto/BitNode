import type { Express } from "express";
import { authenticatedAdmin } from "./adminWithdrawals.js";
import { monthlyRoiInput, roiMonthSchema } from "../shared/monthlyRoi.js";

export function registerAdminMonthlyRoiRoutes(app: Express) {
  app.get("/api/admin/monthly-roi", async (req, res) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const month = roiMonthSchema.safeParse(req.query.month);
      if (!month.success) return res.status(400).json({ error: "Selecciona un mes válido." });
      const { data, error } = await admin.client.from("monthly_node_roi")
        .select("rates, version, updated_at").eq("month", `${month.data}-01`).maybeSingle();
      if (error) return res.status(503).json({ error: "La configuración mensual no está disponible. Verifica la migración de ROI." });
      return res.json({ month: month.data, rates: data?.rates ?? null, version: data?.version ?? 0, updatedAt: data?.updated_at ?? null });
    } catch {
      return res.status(503).json({ error: "No se pudo cargar la configuración mensual." });
    }
  });

  app.put("/api/admin/monthly-roi", async (req, res) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const input = monthlyRoiInput.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "Completa los cuatro porcentajes entre 0 y 1000, con hasta dos decimales, y un mes válido." });
      const { month, rates, version } = input.data;
      const { data, error } = await admin.client.rpc("save_monthly_node_roi", {
        p_month: `${month}-01`, p_rates: rates, p_expected_version: version, p_actor: admin.userId,
      });
      if (error) return res.status(error.code === "40001" ? 409 : 503).json({
        error: error.code === "40001" ? "Otro administrador cambió este mes. Recarga el mes antes de guardar." : "No se guardaron los porcentajes. Verifica la migración y vuelve a intentarlo.",
      });
      return res.json({ month, rates: data.rates, version: data.version, updatedAt: data.updated_at });
    } catch {
      return res.status(503).json({ error: "No se pudieron guardar los porcentajes." });
    }
  });
}
