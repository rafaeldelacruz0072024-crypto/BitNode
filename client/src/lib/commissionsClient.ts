import { supabase } from "./supabaseClient";

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
    throw new Error("Sesión Supabase requerida para activar contratos.");

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
    throw new Error("Sesión Supabase requerida para liquidar comisiones.");

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
