/* Adaptador de transacciones: usa Supabase REST con RLS cuando hay configuración; si no, conserva el flujo local. */
import { Movement } from "./localUserStore";

export type TransactionPayload = Movement & { username: string };

function config() { const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined; return { url: import.meta.env.VITE_SUPABASE_URL as string | undefined, anonKey, authHeader: anonKey?.startsWith("eyJ") ? `Bearer ${anonKey}` : undefined }; }
function headers(anonKey: string, authHeader?: string) { return { apikey: anonKey, ...(authHeader ? { Authorization: authHeader } : {}) }; }

export async function persistTransaction(payload: TransactionPayload): Promise<"remote" | "local"> {
  const { url, anonKey, authHeader } = config();
  if (!url || !anonKey) return "local";
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/transactions`, { method: "POST", headers: { ...headers(anonKey, authHeader), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ ...payload, net_amount: payload.netAmount, created_at: payload.date }) });
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
  return "remote";
}

export async function fetchTransactions(username: string): Promise<Movement[] | null> {
  const { url, anonKey, authHeader } = config();
  if (!url || !anonKey) return null;
  const query = `${url.replace(/\/$/, "")}/rest/v1/transactions?username=eq.${encodeURIComponent(username)}&order=created_at.desc&limit=100`;
  const response = await fetch(query, { headers: headers(anonKey, authHeader) });
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
  const rows = await response.json();
  return rows.map((row: Record<string, unknown>) => ({ id: String(row.id), type: row.type, label: String(row.label), amount: Number(row.amount), status: row.status, date: String(row.created_at), network: row.network ? String(row.network) : undefined, wallet: row.wallet ? String(row.wallet) : undefined, fee: row.fee ? Number(row.fee) : undefined, netAmount: row.net_amount ? Number(row.net_amount) : undefined }));
}
