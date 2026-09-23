/* Persistencia remota protegida por Supabase Auth; si no hay sesión o configuración, el dashboard conserva su fallback local. */
import { Contract, Movement } from "./localUserStore";
import { supabase } from "./supabaseClient";

export type TransactionPayload = Movement & {
  userId: string;
  username?: string;
};

function config() {
  return {
    url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
      | string
      | undefined,
  };
}

async function requestHeaders() {
  const { publishableKey } = config();
  if (!publishableKey) return null;
  const session = supabase
    ? (await supabase.auth.getSession()).data.session
    : null;
  if (!session?.access_token) return null;
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function persistTransaction(
  payload: TransactionPayload
): Promise<"remote" | "local"> {
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
  const response = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/transactions`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) throw new Error(`El servicio respondió ${response.status}`);
  return "remote";
}

export function mergeTransactions(local: Movement[], remote: Movement[]) {
  const remoteIds = new Set(remote.map(item => item.id));
  return [...remote, ...local.filter(item => !remoteIds.has(item.id))];
}

export function summarizeCompletedLedger(movements: Movement[]) {
  return movements.reduce(
    (summary, movement) => {
      if (movement.type === "withdraw" && (movement.status === "pending" || movement.status === "approved")) {
        summary.balance += Number.isFinite(movement.amount) ? movement.amount : 0;
        return summary;
      }
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

type AccountSummary = { movements: Movement[]; contracts: Contract[]; ledger: { balance: number; totalInvested: number; totalYield: number } };

export type WithdrawalAvailability = {
  migrationReady: boolean;
  lockedDirect: number;
  directUnspent: number;
  directAvailable: number;
  weeklyBonusUnspent: number;
  finiteNodeRoiUnspent: number;
  dailyNodeRoiCredited: number;
  unrestricted: number;
  withdrawableBalance: number;
  nextDirectAvailableAt: string | null;
  weeklyWindowOpen: boolean;
  nextWeeklyWindowAt: string | null;
  weeklyWindowClosesAt: string | null;
  globalWindowEnabled: boolean;
};

export async function fetchWithdrawalAvailability(): Promise<WithdrawalAvailability> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) throw new Error("Sesión requerida para consultar la comisión directa.");
  const response = await fetch("/api/account/withdrawal-availability", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "No se pudo cargar el contador."));
  const amounts = [payload.lockedDirect, payload.directUnspent, payload.directAvailable,
    payload.weeklyBonusUnspent, payload.finiteNodeRoiUnspent, payload.dailyNodeRoiCredited,
    payload.unrestricted, payload.withdrawableBalance];
  const dates = [payload.nextDirectAvailableAt, payload.nextWeeklyWindowAt, payload.weeklyWindowClosesAt];
  if (amounts.some(value => !Number.isFinite(value)) ||
    dates.some(value => value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) ||
    typeof payload.weeklyWindowOpen !== "boolean" || typeof payload.globalWindowEnabled !== "boolean" ||
    typeof payload.migrationReady !== "boolean") {
    throw new Error("El servidor devolvió un contador inválido.");
  }
  return payload as WithdrawalAvailability;
}

function formatPercent(value: unknown) {
  const percent = Number(value) * 100;
  return Number.isFinite(percent) ? `${Number(percent.toFixed(4))}%` : "0%";
}

export async function fetchAccountSummary(): Promise<AccountSummary | null> {
  const session = supabase
    ? (await supabase.auth.getSession()).data.session
    : null;
  if (!session?.access_token) return null;
  const response = await fetch("/api/account/summary", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(String(payload.error || "No se pudo cargar el balance."));
  const rows = Array.isArray(payload.transactions) ? payload.transactions : [];
  const movements = rows.filter((row: Record<string, unknown>) => !String(row.id).startsWith("CAPITAL-RESERVE-")).map((row: Record<string, unknown>) => ({
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
    directCommissionSpent: Number(row.direct_commission_spent) || 0,
    weeklyBonusSpent: Number(row.weekly_bonus_spent) || 0,
    nodeRoiSpent: Number(row.node_roi_spent) || 0,
  })) as Movement[];
  const choices = Array.isArray(payload.capitalChoices) ? payload.capitalChoices as Array<Record<string, unknown>> : [];
  for (const choice of choices) if (choice.action === "claim") movements.push({
    id: `CAPITAL-CLAIM-${choice.contract_id}`, type: "withdraw",
    label: `Retiro de capital del nodo ${choice.contract_id}`,
    amount: -Number(choice.amount), status: String(choice.status) as Movement["status"],
    date: String(choice.requested_at), network: "BNB Chain", wallet: String(choice.wallet || ""),
    fee: Number(choice.fee), netAmount: Number(choice.net_amount),
  });
  const contractRows = Array.isArray(payload.contracts)
    ? payload.contracts
    : [];
  const contracts = contractRows.map((row: Record<string, unknown>) => {
    const plan =
      row.plans && typeof row.plans === "object"
        ? (row.plans as Record<string, unknown>)
        : {};
    const durationDays = Number(plan.duration_days);
    return {
      id: String(row.id),
      name: String(plan.name || row.plan_id || "Nodo"),
      rate: `${formatPercent(plan.rate_min)} – ${formatPercent(plan.rate_max)}`,
      amount: Number(row.amount),
      status: String(row.status) as Contract["status"],
      createdAt: String(row.starts_at || row.created_at || ""),
      duration:
        Number.isFinite(durationDays) && durationDays > 0
          ? `${durationDays} días + capital de vuelta`
          : "Indefinida",
      capitalChoice: (() => {
        const choice = choices.find(item => item.contract_id === row.id);
        return choice ? { action: String(choice.action) as "claim" | "reinvest", status: String(choice.status), payableAt: choice.payable_at ? String(choice.payable_at) : null } : undefined;
      })(),
      capitalChoiceReady: payload.capitalChoiceReady === true,
    };
  });
  const ledger = payload.ledger;
  if (!ledger || ![ledger.balance, ledger.totalInvested, ledger.totalYield].every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("No se pudo verificar el saldo disponible.");
  }
  return { movements, contracts, ledger };
}

export async function fetchTransactions(
  userId: string
): Promise<Movement[] | null> {
  void userId;
  const summary = await fetchAccountSummary();
  return summary?.movements ?? null;
}
