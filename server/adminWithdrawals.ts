import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "gentecash@gmail.com";

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

async function authenticatedAdmin(req: Request) {
  const client = serviceClient();
  const accessToken = token(req);
  if (!accessToken) return { client, error: "Sesión requerida.", status: 401 } as const;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return { client, error: "La sesión no es válida.", status: 401 } as const;
  const { data: profile, error: profileError } = await client.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profileError || profile?.role !== "admin" || data.user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return { client, error: "No tienes permisos para gestionar retiros.", status: 403 } as const;
  }
  return { client } as const;
}

const cleanReference = (value: unknown) => String(value || "").trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);

export function registerAdminWithdrawalRoutes(app: Express) {
  app.get("/api/admin/withdrawals", async (req, res) => {
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const { data, error } = await admin.client.from("transactions")
        .select("id,user_id,username,label,amount,status,network,wallet,fee,net_amount,provider_status,created_at")
        .eq("type", "withdraw").order("created_at", { ascending: false }).limit(200);
      if (error) return res.status(500).json({ error: "No se pudo cargar la cola de retiros." });
      return res.status(200).json({ withdrawals: data || [] });
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
      const { error: updateError } = await admin.client.from("transactions")
        .update({ status: transition.to, provider_status: transition.provider }).eq("id", id).eq("status", status);
      if (updateError) return res.status(500).json({ error: "No se pudo actualizar el retiro." });
      return res.status(200).json({ id, status: transition.to, providerStatus: transition.provider });
    } catch (error) {
      console.error("[admin-withdrawals]", error);
      return res.status(503).json({ error: "El módulo de retiros no está disponible." });
    }
  });
}
