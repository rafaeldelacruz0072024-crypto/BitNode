import { supabase } from "./supabaseClient";

export type DailyTaskResult = {
  status: "task_completed" | "already_completed" | "credited";
  cycle_day: number;
  completed_tasks: string[];
  remaining_tasks?: number;
  reward?: number;
  rate?: number;
  transaction_id?: string;
  credited?: boolean;
  capital_preserved?: boolean;
  rewards?: DailyNodeReward[];
};

export type DailyNodeReward = {
  contract_id: string;
  plan_id?: string;
  plan_name: string;
  capital: number;
  rate: number;
  rate_percent: number;
  reward: number;
  transaction_id?: string;
};

export async function completeDailyTask(contractId: string, taskKey: string) {
  if (!supabase) throw new Error("El servicio no está configurado.");
  const { data, error } = await supabase.rpc("complete_daily_task", {
    p_contract_id: contractId,
    p_task_key: taskKey,
  });
  if (error) throw new Error(error.message);
  return data as DailyTaskResult;
}

export async function fetchDailyTaskProgress(contractId: string) {
  if (!supabase) throw new Error("El servicio no está configurado.");
  const { data, error } = await supabase
    .from("daily_task_progress")
    .select("cycle_day, completed_tasks, last_task_at")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { cycle_day: number; completed_tasks: string[]; last_task_at: string | null } | null;
}

export type CommissionSummary = {
  direct: number;
  binary: number;
  total: number;
  binaryVolume?: {
    left: number;
    right: number;
    matched: number;
    status: "paired" | "awaiting_pair" | "no_volume";
    updatedAt: string | null;
  };
  entries: Array<{
    id: string;
    source_user_id?: string;
    source_username?: string;
    node_name?: string;
    contract_amount?: number | null;
    commission_type: string;
    amount: number | string;
    rate: number | string;
    leg: string | null;
    metadata?: Record<string, unknown>;
    status: string;
    source_event_id: string;
    created_at: string;
  }>;
  networkNodes?: Array<{
    user_id: string;
    username?: string;
    parent_id: string | null;
    leg: "left" | "right" | null;
    sponsor_id: string | null;
  }>;
};

async function accessToken() {
  return (
    (await supabase?.auth.getSession())?.data.session?.access_token || null
  );
}

export async function fetchCommissionSummary(): Promise<CommissionSummary | null> {
  const token = await accessToken();
  if (!token) return null;

  const response = await fetch("/api/commissions/summary", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error("No se pudo cargar el resumen de comisiones.");
  return response.json() as Promise<CommissionSummary>;
}

export async function activateContractAndCommissions(input: {
  contractId: string;
  planId: string;
  amount: number;
}) {
  const token = await accessToken();
  if (!token)
    throw new Error("Inicia sesión para activar nodos.");

  const response = await fetch("/api/contracts/activate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(String(payload.error || "No se pudo activar el contrato."));
  return payload as {
    status?: string;
    contract_id?: string;
    commission?: Record<string, unknown>;
  };
}

export async function processConfirmedContractCommission(contractId: string) {
  const token = await accessToken();
  if (!token)
    throw new Error("Inicia sesión para liquidar comisiones.");

  const response = await fetch("/api/commissions/contract-confirmed", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contractId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      String(payload.error || "No se pudo liquidar la comisión.")
    );
  return payload as {
    status?: string;
    direct_bonus?: number;
    binary_bonus?: number;
  };
}
