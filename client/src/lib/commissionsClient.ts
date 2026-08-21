import { supabase } from "./supabaseClient";

export type CommissionSummary = {
  direct: number;
  binary: number;
  total: number;
  entries: Array<{
    id: string;
    commission_type: string;
    amount: number | string;
    rate: number | string;
    leg: string | null;
    status: string;
    source_event_id: string;
    created_at: string;
  }>;
};

export async function fetchCommissionSummary(): Promise<CommissionSummary | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  const response = await fetch("/api/commissions/summary", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("No se pudo cargar el resumen de comisiones.");
  return response.json() as Promise<CommissionSummary>;
}
