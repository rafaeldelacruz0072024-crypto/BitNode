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

type NetworkTreeRow = {
  user_id: string;
  parent_id: string | null;
  leg: "left" | "right" | null;
  sponsor_id: string | null;
  username?: string;
  depth?: number;
};

export async function processContractCommissionsWithClient(
  client: Pick<SupabaseClient, "rpc">,
  input: CommissionEventInput
) {
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
  if (!client)
    throw new Error("Supabase server credentials are not configured.");
  return processContractCommissionsWithClient(client, input);
}

export function validateCommissionEventInput(input: CommissionEventInput) {
  return Boolean(
    input.sourceEventId &&
      input.contractId &&
      input.userId &&
      Number.isFinite(input.amount) &&
      input.amount > 0
  );
}

export function summarizeCommissionRows(
  rows: Array<{
    commission_type: string;
    amount: number | string | null;
    status: string;
  }>
) {
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
  if (!client)
    throw new Error("Supabase server credentials are not configured.");

  const { data, error } = await client
    .from("commission_ledger")
    .select(
      "id, source_user_id, commission_type, amount, rate, leg, status, source_event_id, created_at, metadata"
    )
    .eq("beneficiary_id", userId)
    .order("created_at", { ascending: false });
  if (error)
    throw new Error(`Commission ledger query failed: ${error.message}`);

  const rows = data || [];
  const [ownerResult, treeResult, volumeResult] = await Promise.all([
    client.from("profiles").select("username, referral_code").eq("id", userId).maybeSingle(),
    client.rpc("get_my_network_tree", { p_user_id: userId, p_max_depth: 12 }),
    client.from("network_volume").select("leg, volume, matched_volume, updated_at").eq("user_id", userId),
  ]);
  const { data: ownerProfile, error: ownerProfileError } = ownerResult;
  if (ownerProfileError)
    throw new Error(`Owner profile query failed: ${ownerProfileError.message}`);
  const sourceUserIds = Array.from(new Set(rows.map(row => row.source_user_id).filter(Boolean)));
  const contractIds = Array.from(new Set(rows.map(row => String((row.metadata as Record<string, unknown> | null)?.contract_id || "")).filter(Boolean)));
  const [{ data: sourceProfiles }, { data: sourceContracts }] = await Promise.all([
    sourceUserIds.length
      ? client.from("profiles").select("id, username").in("id", sourceUserIds)
      : Promise.resolve({ data: [] }),
    contractIds.length
      ? client.from("contracts").select("id, plan_id, amount").in("id", contractIds)
      : Promise.resolve({ data: [] }),
  ]);
  const planIds = Array.from(new Set((sourceContracts || []).map(contract => contract.plan_id).filter(Boolean)));
  const { data: sourcePlans } = planIds.length
    ? await client.from("plans").select("id, name").in("id", planIds)
    : { data: [] };
  const profilesById = new Map((sourceProfiles || []).map(profile => [profile.id, profile.username]));
  const contractsById = new Map((sourceContracts || []).map(contract => [contract.id, contract]));
  const plansById = new Map((sourcePlans || []).map(plan => [plan.id, plan.name]));
  const enrichedRows = rows.map(row => {
    const metadata = (row.metadata || {}) as Record<string, unknown>;
    const contract = contractsById.get(String(metadata.contract_id || ""));
    return {
      ...row,
      source_username: profilesById.get(row.source_user_id) || "Usuario referido",
      node_name: contract ? plansById.get(contract.plan_id) || contract.plan_id : "Nodo no identificado",
      contract_amount: contract ? Number(contract.amount) : null,
    };
  });
  const networkError = treeResult.error;
  const networkNodes = (treeResult.data || []) as NetworkTreeRow[];
  if (networkError)
    throw new Error(`Network tree query failed: ${networkError.message}`);
  if (volumeResult.error)
    throw new Error(`Network volume query failed: ${volumeResult.error.message}`);
  const networkUserIds = Array.from(new Set((networkNodes || []).map(node => node.user_id)));
  const { data: networkProfiles } = networkUserIds.length
    ? await client.from("profiles").select("id, username").in("id", networkUserIds)
    : { data: [] };
  const networkNamesById = new Map((networkProfiles || []).map(profile => [profile.id, profile.username]));
  const directNodes = (networkNodes || []).filter(node => node.sponsor_id === userId);
  const directUserIds = directNodes.map(node => node.user_id);
  const { data: directContracts } = directUserIds.length
    ? await client.from("contracts").select("user_id, status").in("user_id", directUserIds)
    : { data: [] };
  const activeNodesByUserId = new Map<string, number>();
  for (const contract of directContracts || []) {
    if (contract.status !== "active") continue;
    activeNodesByUserId.set(
      contract.user_id,
      (activeNodesByUserId.get(contract.user_id) || 0) + 1
    );
  }
  const leftVolume = Number(volumeResult.data?.find(row => row.leg === "left")?.volume || 0);
  const rightVolume = Number(volumeResult.data?.find(row => row.leg === "right")?.volume || 0);
  const matchedVolume = Math.max(
    ...((volumeResult.data || []).map(row => Number(row.matched_volume || 0))),
    0
  );
  const updatedAt = (volumeResult.data || [])
    .map(row => row.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  return {
    ...summarizeCommissionRows(rows),
    ownerUsername: ownerProfile?.username || null,
    referralCode: ownerProfile?.referral_code || null,
    binaryVolume: {
      left: leftVolume,
      right: rightVolume,
      matched: matchedVolume,
      status: matchedVolume > 0 ? "paired" : leftVolume > 0 || rightVolume > 0 ? "awaiting_pair" : "no_volume",
      updatedAt,
    },
    entries: enrichedRows,
    networkNodes: (networkNodes || []).map(node => ({
      ...node,
      username: networkNamesById.get(node.user_id) || "Usuario",
    })),
    directReferrals: directNodes.map(node => ({
      user_id: node.user_id,
      username: networkNamesById.get(node.user_id) || "Usuario",
      leg: node.parent_id === userId ? node.leg : null,
      active_nodes: activeNodesByUserId.get(node.user_id) || 0,
    })),
  };
}

export async function activateContractAndCommissions(
  client: SupabaseClient,
  input: {
    userId: string;
    contractId: string;
    planId: string;
    username?: string;
    amount: number;
  }
) {
  if (
    !input.contractId ||
    !input.planId ||
    !Number.isFinite(input.amount) ||
    input.amount < 10
  ) {
    throw new Error("Invalid contract activation input.");
  }

  const { data: placement, error: placementError } = await client.rpc(
    "place_network_node",
    {
      p_user_id: input.userId,
      p_sponsor_id: null,
      p_preferred_leg: null,
    }
  );
  if (placementError)
    throw new Error(`Network placement RPC failed: ${placementError.message}`);

  const { data, error } = await client.rpc("activate_plan_and_node", {
    p_user_id: input.userId,
    p_contract_id: input.contractId,
    p_plan_id: input.planId,
    p_amount: input.amount,
    p_parent_id: placement?.parent_id ?? null,
    p_leg: placement?.leg ?? null,
    p_username: input.username || null,
  });
  if (error) throw new Error(`Plan activation RPC failed: ${error.message}`);
  return { ...(data as Record<string, unknown>), placement };
}

export async function processConfirmedContractCommissions(
  client: SupabaseClient,
  userId: string,
  contractId: string
) {
  const { data: transaction, error: transactionError } = await client
    .from("transactions")
    .select("id, user_id, type, status, amount")
    .eq("id", contractId)
    .eq("user_id", userId)
    .maybeSingle();
  if (transactionError)
    throw new Error(`Contract lookup failed: ${transactionError.message}`);
  if (
    !transaction ||
    transaction.type !== "contract" ||
    transaction.status !== "completed"
  ) {
    throw new Error(
      "Only completed contract transactions can generate commissions."
    );
  }

  return processContractCommissionsWithClient(client, {
    sourceEventId: `contract:${contractId}:confirmed`,
    contractId,
    userId,
    amount: Math.abs(Number(transaction.amount)),
    eventType: "contract_confirmed",
  });
}

export function registerCommissionRoutes(app: Express) {
  app.get("/api/commissions/summary", async (req: Request, res: Response) => {
    const client = adminClient();
    const accessToken = bearer(req);
    if (!client || !accessToken)
      return res.status(401).json({ error: "Sesión Supabase requerida." });

    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user)
      return res.status(401).json({ error: "Sesión Supabase inválida." });

    try {
      return res.json(await getCommissionSummary(data.user.id));
    } catch (error) {
      console.error("[Commissions] summary error", error);
      return res
        .status(500)
        .json({ error: "No se pudo leer el ledger de comisiones." });
    }
  });

  app.post("/api/contracts/activate", async (req: Request, res: Response) => {
    const client = adminClient();
    const accessToken = bearer(req);
    if (!client || !accessToken)
      return res.status(401).json({ error: "Sesión Supabase requerida." });

    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user)
      return res.status(401).json({ error: "Sesión Supabase inválida." });

    const contractId = String(req.body?.contractId || "").trim();
    const planId = String(req.body?.planId || "").trim();
    const amount = Number(req.body?.amount);
    if (!contractId || !planId || !Number.isFinite(amount))
      return res.status(400).json({ error: "Datos de contrato incompletos." });

    try {
      const result = await activateContractAndCommissions(client, {
        userId: data.user.id,
        contractId,
        planId,
        username:
          data.user.user_metadata?.username || data.user.email?.split("@")[0],
        amount,
      });
      return res.json(result);
    } catch (error) {
      console.error("[Contracts] activation error", error);
      return res
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "No se pudo activar el contrato.",
        });
    }
  });

  app.post(
    "/api/commissions/contract-confirmed",
    async (req: Request, res: Response) => {
      const client = adminClient();
      const accessToken = bearer(req);
      if (!client || !accessToken)
        return res.status(401).json({ error: "Sesión Supabase requerida." });

      const { data, error } = await client.auth.getUser(accessToken);
      if (error || !data.user)
        return res.status(401).json({ error: "Sesión Supabase inválida." });

      const contractId = String(req.body?.contractId || "").trim();
      if (!contractId)
        return res.status(400).json({ error: "contractId es requerido." });

      try {
        const result = await processConfirmedContractCommissions(
          client,
          data.user.id,
          contractId
        );
        return res.json(result);
      } catch (error) {
        console.error("[Commissions] contract confirmation error", error);
        return res
          .status(400)
          .json({
            error:
              error instanceof Error
                ? error.message
                : "No se pudo procesar la comisión.",
          });
      }
    }
  );
}
