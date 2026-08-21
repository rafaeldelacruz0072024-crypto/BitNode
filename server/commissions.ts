import type { Express, Request, Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey
    ? createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
}

function bearer(req: Request) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export type CommissionEventInput = {
  sourceEventId: string;
  contractId: string;
  userId: string;
  amount: number;
  eventType?: "contract_confirmed" | "contract_reversed";
};

export async function processContractCommissionsWithClient(client: Pick<SupabaseClient, "rpc">, input: CommissionEventInput) {
  if (!input.sourceEventId || !input.contractId || !input.userId) {
    throw new Error("Commission event identifiers are required.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Commission event amount must be positive.");
  }

  const { data, error } = await client.rpc("process_contract_commissions", {
    p_source_event_id: input.sourceEventId,
    p_contract_id: input.contractId,
    p_user_id: input.userId,
    p_amount: input.amount,
    p_event_type: input.eventType || "contract_confirmed",
  });
  if (error) throw new Error(`Commission RPC failed: ${error.message}`);
  return data as Record<string, unknown>;
}

export async function processContractCommissions(input: CommissionEventInput) {
  const client = adminClient();
  if (!client) throw new Error("Supabase server credentials are not configured.");
  return processContractCommissionsWithClient(client, input);
}

export function validateCommissionEventInput(input: CommissionEventInput) {
  return Boolean(
    input.sourceEventId &&
      input.contractId &&
      input.userId &&
      Number.isFinite(input.amount) &&
      input.amount > 0,
  );
}

export function summarizeCommissionRows(rows: Array<{ commission_type: string; amount: number | string | null; status: string }>) {
  const credited = rows.filter(row => row.status === "credited");
  const direct = credited
    .filter(row => row.commission_type === "direct")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const binary = credited
    .filter(row => row.commission_type === "binary")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return { direct, binary, total: direct + binary };
}

export async function getCommissionSummary(userId: string) {
  const client = adminClient();
  if (!client) throw new Error("Supabase server credentials are not configured.");

  const { data, error } = await client
    .from("commission_ledger")
    .select("id, commission_type, amount, rate, leg, status, source_event_id, created_at")
    .eq("beneficiary_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Commission ledger query failed: ${error.message}`);

  const rows = data || [];
  return {
    ...summarizeCommissionRows(rows),
    entries: rows,
  };
}

export function registerCommissionRoutes(app: Express) {
  app.get("/api/commissions/summary", async (req: Request, res: Response) => {
    const client = adminClient();
    const accessToken = bearer(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesión Supabase requerida." });

    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return res.status(401).json({ error: "Sesión Supabase inválida." });

    try {
      return res.json(await getCommissionSummary(data.user.id));
    } catch (error) {
      console.error("[Commissions] summary error", error);
      return res.status(500).json({ error: "No se pudo leer el ledger de comisiones." });
    }
  });
}
