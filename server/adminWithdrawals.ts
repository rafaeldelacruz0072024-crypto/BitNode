import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { recordAdminOperation } from "./adminAudit.js";

function serviceClient() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Las credenciales administrativas no están configuradas.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function token(req: Request) {
  const header = req.header("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function authenticatedAdmin(req: Request) {
  const client = serviceClient();
  const accessToken = token(req);
  if (!accessToken) return { client, error: "Sesión requerida.", status: 401 } as const;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return { client, error: "La sesión no es válida.", status: 401 } as const;
  const { data: profile, error: profileError } = await client.from("profiles").select("role,username").eq("id", data.user.id).maybeSingle();
  if (profileError || profile?.role !== "admin") {
    return { client, error: "No tienes permisos para gestionar retiros.", status: 403 } as const;
  }
  return { client, userId: data.user.id, email: data.user.email || null, username: profile.username || null } as const;
}

async function withdrawalWindow(client: ReturnType<typeof serviceClient>) {
  const { data } = await client.from("platform_settings").select("value").eq("key", "withdrawal_window").maybeSingle();
  return data?.value && typeof data.value === "object" && (data.value as { enabled?: boolean }).enabled === true;
}

const cleanReference = (value: unknown) => String(value || "").trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);

export function registerAdminWithdrawalRoutes(app: Express) {
  app.get("/api/admin/audit-log", async (req, res) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const { data, error } = await admin.client.from("admin_operation_audit_log")
        .select("id,admin_id,admin_email,admin_username,action,target_type,target_id,details,created_at")
        .order("created_at", { ascending: false }).limit(300);
      if (error && (error.code === "42P01" || error.code === "PGRST205")) {
        const { data: fallback, error: fallbackError } = await admin.client.from("platform_settings")
          .select("key,value,updated_at").like("key", "admin_audit:%").order("updated_at", { ascending: false }).limit(300);
        if (fallbackError) return res.status(500).json({ error: "No se pudo cargar el historial administrativo." });
        const entries = (fallback || []).map(row => ({ id: row.key, ...((row.value || {}) as Record<string, unknown>), created_at: row.updated_at }));
        return res.status(200).json({ entries, storage: "compatibility" });
      }
      if (error) return res.status(500).json({ error: "No se pudo cargar el historial administrativo." });
      return res.status(200).json({ entries: data || [] });
    } catch (error) {
      console.error("[admin-audit-log]", error);
      return res.status(503).json({ error: "El historial administrativo no está disponible." });
    }
  });

  app.get("/api/support/whatsapp", async (_req, res) => {
    try {
      const client = serviceClient();
      const { data } = await client.from("platform_settings").select("value").eq("key", "support_whatsapp").maybeSingle();
      const number = data?.value && typeof data.value === "object" ? String((data.value as { number?: string }).number || "") : "";
      return res.status(200).json({ number });
    } catch {
      return res.status(200).json({ number: "" });
    }
  });

  app.get("/api/admin/support-whatsapp", async (req, res) => {
    const admin = await authenticatedAdmin(req);
    if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
    const { data } = await admin.client.from("platform_settings").select("value").eq("key", "support_whatsapp").maybeSingle();
    const number = data?.value && typeof data.value === "object" ? String((data.value as { number?: string }).number || "") : "";
    return res.status(200).json({ number });
  });

  app.patch("/api/admin/support-whatsapp", async (req: Request, res: Response) => {
    const admin = await authenticatedAdmin(req);
    if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
    const number = String(req.body?.number || "").replace(/\D/g, "");
    if (number.length < 8 || number.length > 15) return res.status(400).json({ error: "Introduce el número con código de país." });
    const { error } = await admin.client.from("platform_settings").upsert({
      key: "support_whatsapp", value: { number, updated_by: admin.userId }, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) return res.status(500).json({ error: "No se pudo guardar el WhatsApp de soporte." });
    await recordAdminOperation(admin.client, { adminId: admin.userId, adminEmail: admin.email, adminUsername: admin.username, action: "support_whatsapp_updated", targetType: "platform_setting", targetId: "support_whatsapp", details: { numberEnding: number.slice(-4) } });
    return res.status(200).json({ number });
  });

  app.get("/api/admin/withdrawal-window", async (req, res) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      return res.status(200).json({ enabled: await withdrawalWindow(admin.client) });
    } catch (error) {
      console.error("[admin-withdrawal-window]", error);
      return res.status(503).json({ error: "No se pudo consultar la ventana de retiros." });
    }
  });

  app.patch("/api/admin/withdrawal-window", async (req: Request, res: Response) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const enabled = req.body?.enabled === true;
      const { error } = await admin.client.from("platform_settings").upsert({
        key: "withdrawal_window",
        value: { enabled, mode: "scheduled_mexico", updated_by: (await admin.client.auth.getUser(token(req))).data.user?.id || null },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      if (error) return res.status(500).json({ error: "No se pudo actualizar la ventana de retiros." });
      await recordAdminOperation(admin.client, { adminId: admin.userId, adminEmail: admin.email, adminUsername: admin.username, action: enabled ? "withdrawal_window_enabled" : "withdrawal_window_disabled", targetType: "platform_setting", targetId: "withdrawal_window" });
      return res.status(200).json({ enabled });
    } catch (error) {
      console.error("[admin-withdrawal-window]", error);
      return res.status(503).json({ error: "La configuración de retiros no está disponible." });
    }
  });

  app.get("/api/admin/withdrawals", async (req, res) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const { data, error } = await admin.client.from("transactions")
        .select("id,user_id,username,label,amount,status,network,wallet,fee,net_amount,provider_status,direct_commission_spent,weekly_bonus_spent,node_roi_spent,created_at")
        .eq("type", "withdraw").order("created_at", { ascending: false }).limit(200);
      if (error) return res.status(500).json({ error: "No se pudo cargar la cola de retiros." });
      const { data: capitalClaims, error: claimsError } = await admin.client.from("finite_node_capital_choices")
        .select("contract_id,user_id,amount,fee,net_amount,wallet,status,requested_at,payable_at")
        .eq("action", "claim").order("requested_at", { ascending: false }).limit(200);
      if (claimsError && claimsError.code !== "PGRST205") return res.status(500).json({ error: "No se pudo cargar la cola de retiros de capital." });
      const userIds = Array.from(new Set((capitalClaims || []).map(row => row.user_id)));
      const { data: owners } = userIds.length ? await admin.client.from("profiles").select("id,username").in("id", userIds) : { data: [] };
      const names = new Map((owners || []).map(row => [row.id, row.username]));
      const claims = (capitalClaims || []).map(row => ({
        id: `CAPITAL-CLAIM-${row.contract_id}`, user_id: row.user_id,
        username: names.get(row.user_id) || null, label: `Capital del nodo ${row.contract_id}`,
        amount: -Number(row.amount), fee: row.fee, net_amount: row.net_amount,
        status: row.status, network: "BNB Chain", wallet: row.wallet,
        provider_status: "retiro_capital_nodo", created_at: row.requested_at, payable_at: row.payable_at,
      }));
      return res.status(200).json({ withdrawals: [...(data || []), ...claims].sort((a, b) =>
        Date.parse(String(b.created_at)) - Date.parse(String(a.created_at))) });
    } catch (error) {
      console.error("[admin-withdrawals]", error);
      return res.status(503).json({ error: "El módulo de retiros no está disponible." });
    }
  });

  app.post("/api/admin/withdrawals", async (req: Request, res: Response) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const id = String(req.body?.id || "").trim().slice(0, 160);
      const action = String(req.body?.action || "").trim();
      if (!id || !["approve", "mark_paid", "reject"].includes(action)) return res.status(400).json({ error: "La acción de retiro no es válida." });
      if (id.startsWith("CAPITAL-CLAIM-")) {
        const reference = cleanReference(req.body?.reference);
        const { data, error } = await admin.client.rpc("manage_finite_node_claim", {
          p_contract_id: id.slice("CAPITAL-CLAIM-".length), p_action: action,
          p_admin_id: admin.userId, p_reference: reference || null,
        });
        if (error) return res.status(error.code === "P0001" ? 409 : 500)
          .json({ error: error.code === "P0001" ? error.message : "No se pudo actualizar el retiro de capital." });
        await recordAdminOperation(admin.client, { adminId: admin.userId, adminEmail: admin.email, adminUsername: admin.username, action: `capital_withdrawal_${action}`, targetType: "finite_node_capital_claim", targetId: id, details: { reference: reference || null, status: data.status } });
        return res.status(200).json({ id, status: data.status });
      }
      const { data: withdrawal, error: lookupError } = await admin.client.from("transactions").select("id,status,type").eq("id", id).maybeSingle();
      if (lookupError || !withdrawal || withdrawal.type !== "withdraw") return res.status(404).json({ error: "Solicitud de retiro no encontrada." });
      const status = String(withdrawal.status);
      const ref = cleanReference(req.body?.reference);
      const transitions = {
        approve: { from: ["pending"], to: "approved", provider: "manual_approved" },
        mark_paid: { from: ["approved"], to: "completed", provider: ref ? `manual_paid:${ref}` : "manual_paid" },
        reject: { from: ["pending", "approved"], to: "rejected", provider: ref ? `manual_rejected:${ref}` : "manual_rejected" },
      } as const;
      const transition = transitions[action as keyof typeof transitions];
      if (!transition.from.includes(status as never)) return res.status(409).json({ error: "La solicitud no permite esta acción en su estado actual." });
      const { data: updated, error: updateError } = await admin.client.from("transactions")
        .update({ status: transition.to, provider_status: transition.provider }).eq("id", id).eq("status", status).select("id").maybeSingle();
      if (updateError) return res.status(500).json({ error: "No se pudo actualizar el retiro." });
      if (!updated) return res.status(409).json({ error: "El retiro cambió de estado. Actualiza la lista." });
      await recordAdminOperation(admin.client, { adminId: admin.userId, adminEmail: admin.email, adminUsername: admin.username, action: `withdrawal_${action}`, targetType: "transaction", targetId: id, details: { fromStatus: status, toStatus: transition.to, reference: ref || null } });
      return res.status(200).json({ id, status: transition.to, providerStatus: transition.provider });
    } catch (error) {
      console.error("[admin-withdrawals]", error);
      return res.status(503).json({ error: "El módulo de retiros no está disponible." });
    }
  });
}
