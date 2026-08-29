import type { Express, Request, Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey
    ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
}

function bearer(req: Request): string | null {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

/**
 * Endpoint público del backend. El navegador solo envía contractId.
 * userId y amount se obtienen de Supabase; nunca se aceptan del cliente.
 */
export function registerSecureCommissionRoutes(app: Express) {
  app.post("/api/commissions/process", async (req: Request, res: Response) => {
    const client = adminClient();
    const accessToken = bearer(req);
    if (!client || !accessToken) {
      return res.status(401).json({ error: "Sesión Supabase requerida." });
    }

    const { data: authData, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return res.status(401).json({ error: "Sesión Supabase inválida." });
    }

    const contractId = String(req.body?.contractId || "").trim();
    if (!contractId || contractId.length > 128) {
      return res.status(400).json({ error: "contractId es requerido." });
    }

    const { data: contract, error: contractError } = await client
      .from("contracts")
      .select("id, user_id, amount, status")
      .eq("id", contractId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (contractError) {
      console.error("[Commissions] Contract lookup failed", contractError);
      return res.status(500).json({ error: "No se pudo verificar el contrato." });
    }
    if (!contract || contract.status !== "active") {
      return res.status(400).json({ error: "Solo los contratos activos pueden liquidar comisiones." });
    }

    const amount = Number(contract.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "El monto del contrato no es válido." });
    }

    const { data, error } = await client.rpc("process_contract_commissions", {
      p_source_event_id: `contract:${contract.id}:confirmed`,
      p_contract_id: contract.id,
      p_user_id: authData.user.id,
      p_amount: amount,
      p_event_type: "contract_confirmed",
    });

    if (error) {
      console.error("[Commissions] RPC failed", error);
      return res.status(400).json({ error: "No se pudo procesar la comisión." });
    }

    return res.json(data);
  });
}
