import type { Express } from "express";
import { createClient } from "@supabase/supabase-js";
import { authenticatedAdmin } from "./adminWithdrawals.js";

export function registerPromotionRoutes(app: Express) {
  app.get("/api/promotions/latam", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const token = req.headers.authorization?.replace(/^Bearer /i, "") || "";
      if (!token)
        return res
          .status(401)
          .json({ error: "Inicia sesión para consultar tu progreso." });
      const client = createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
        process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        { auth: { persistSession: false } }
      );
      const { data: auth, error: failure } = await client.auth.getUser(token);
      if (failure || !auth.user)
        return res.status(401).json({ error: "Sesión no válida." });
      const isAdmin = req.query.admin === "1";
      if (isAdmin) {
        const admin = await authenticatedAdmin(req);
        if (admin.error)
          return res.status(admin.status || 403).json({ error: admin.error });
      }
      const { data, error } = await client.rpc("get_latam_promotion", {
        p_user_id: auth.user.id,
        p_admin: isAdmin,
      });
      if (error)
        return res
          .status(503)
          .json({
            error:
              "Progreso no disponible. Falta verificar la migración de Promociones en Supabase.",
          });
      return res.json(data);
    } catch {
      return res
        .status(503)
        .json({
          error:
            "No se pudo consultar la promoción. No se muestran cifras estimadas.",
        });
    }
  });
  app.post("/api/admin/promotions/latam/validate", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const admin = await authenticatedAdmin(req);
      if (admin.error)
        return res.status(admin.status || 403).json({ error: admin.error });
      const { contractId, depositId, amount, reason, revoke, realSale } =
        req.body || {};
      if (
        typeof contractId !== "string" ||
        contractId.length > 160 ||
        typeof depositId !== "string" ||
        depositId.length > 160 ||
        typeof reason !== "string" ||
        reason.trim().length < 10 ||
        reason.length > 500 ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        realSale !== true ||
        typeof revoke !== "boolean"
      )
        return res
          .status(400)
          .json({
            error:
              "Completa nodo, depósito, importe, motivo y confirmación de venta real.",
          });
      const { data, error } = await admin.client.rpc(
        "admin_validate_latam_sale",
        {
          p_admin_id: admin.userId,
          p_contract_id: contractId,
          p_deposit_id: depositId,
          p_amount: amount,
          p_reason: reason.trim(),
          p_revoke: revoke,
        }
      );
      if (error)
        return res
          .status(error.code === "P0001" || error.code === "23505" ? 409 : 503)
          .json({
            error:
              error.code === "P0001"
                ? error.message
                : error.code === "23505"
                  ? "Esta operación ya fue registrada. No se duplicó la facturación."
                  : "Validación no disponible. Revisa la migración de Promociones.",
          });
      return res.json(data);
    } catch {
      return res
        .status(503)
        .json({
          error:
            "No se pudo guardar. Actualiza el listado antes de reintentar.",
        });
    }
  });
}
