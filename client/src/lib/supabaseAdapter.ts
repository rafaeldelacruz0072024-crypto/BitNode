/* Persistencia remota protegida por Supabase Auth; si no hay sesión o configuración, el dashboard conserva su fallback local. */
import { Movement } from "./localUserStore";
import { supabase } from "./supabaseClient";

export type TransactionPayload = Movement & { userId: string; username?: string };

function config() {
  return {
    url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  };
}

async function requestHeaders() {
  const { publishableKey } = config();
  if (!publishableKey) return null;
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) return null;
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function persistTransaction(payload: TransactionPayload): Promise<"remote" | "local"> {
  const { url } = config();
  const headers = await requestHeaders();
  if (!url || !headers) return "local";
  const body = {
    id: payload.id,
    user_id: payload.userId,
    username: payload.username ?? null,
    type: payload.type,
    label: payload.label,
    amount: payload.amount,
    status: payload.status,
    network: payload.network ?? null,
    wallet: payload.wallet ?? null,
    fee: payload.fee ?? null,
    net_amount: payload.netAmount ?? null,
    created_at: payload.date,
  };
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/transactions`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
  return "remote";
}

export function mergeTransactions(local: Movement[], remote: Movement[]) {
  const remoteIds = new Set(remote.map((item) => item.id));
  return [...remote, ...local.filter((item) => !remoteIds.has(item.id))];
}

export function summarizeCompletedLedger(movements: Movement[]) {
  return movements.reduce(
    (summary, movement) => {
      if (movement.status !== "completed") return summary;
      summary.balance += Number.isFinite(movement.amount) ? movement.amount : 0;
      if (movement.type === "contract" && movement.amount < 0)
        summary.totalInvested += Math.abs(movement.amount);
      if (movement.type === "yield" && movement.amount > 0)
        summary.totalYield += movement.amount;
      return summary;
    },
    { balance: 0, totalInvested: 0, totalYield: 0 }
  );
}

export async function fetchTransactions(userId: string): Promise<Movement[] | null> {
  const { url } = config();
  const headers = await requestHeaders();
  if (!url || !headers) return null;
  const query = `${url.replace(/\/$/, "")}/rest/v1/transactions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100`;
  const response = await fetch(query, { headers });
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
  const rows = await response.json();
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    type: row.type,
    label: String(row.label),
    amount: Number(row.amount),
    status: row.status,
    date: String(row.created_at),
    network: row.network ? String(row.network) : undefined,
    wallet: row.wallet ? String(row.wallet) : undefined,
    fee: row.fee ? Number(row.fee) : undefined,
    netAmount: row.net_amount ? Number(row.net_amount) : undefined,
  }));
}
