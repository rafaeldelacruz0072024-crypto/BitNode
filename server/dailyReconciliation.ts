import type { Express } from "express";
import { authenticatedAdmin } from "./adminWithdrawals.js";

type Transaction = {
  id: string; type: string; status: string; amount: number | string; net_amount: number | string | null;
  provider_status: string | null; provider_payment_id: string | null; created_at: string;
  direct_commission_spent: number | string | null; weekly_bonus_spent: number | string | null; node_roi_spent: number | string | null;
};
type Commission = { commission_type: string; amount: number | string; status: string; created_at: string };
type Contract = { id: string; amount: number | string; status: string; updated_at: string };
const mexicoDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const amount = (value: number | string | null) => Number(value) || 0;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function reconciliationDates(from: string, to: string): string[] | null {
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
  if (!validDay(from) || !validDay(to)) return null;
  const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
  if (span < 0 || span > 30) return null;
  return Array.from({ length: span + 1 }, (_, index) => {
    const day = new Date(`${from}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

export function buildDailyReconciliation(date: string, transactions: Transaction[], commissions: Commission[], contracts: Contract[]) {
  const daily = transactions.filter(row => mexicoDay(row.created_at) === date);
  const open = transactions.filter(row => row.type === "withdraw" && ["pending", "approved"].includes(row.status));
  const dayWithdrawals = daily.filter(row => row.type === "withdraw");
  const crypto = daily.filter(row => row.type === "deposit" && row.status === "completed" && row.id.startsWith("NP-") && row.provider_payment_id && ["finished", "confirmed"].includes(row.provider_status || ""));
  const manual = daily.filter(row => row.type === "deposit" && row.status === "completed" && row.id.startsWith("ADMIN-") && row.provider_status?.startsWith("admin_manual:"));
  const capital = daily.filter(row => row.type === "deposit" && row.status === "completed" && (row.id.startsWith("DAILY-CAPITAL-") || row.id.startsWith("PRINCIPAL-")));
  const other = daily.filter(row => row.type === "deposit" && row.status === "completed" && amount(row.amount) > 0 && !crypto.includes(row) && !manual.includes(row) && !capital.includes(row) && !row.provider_status?.startsWith("promo_cashback:") && row.provider_status !== "finite_capital_refund");
  const credited = commissions.filter(row => row.status === "credited" && mexicoDay(row.created_at) === date);
  const source = (field: "direct_commission_spent" | "weekly_bonus_spent" | "node_roi_spent") => round(open.reduce((total, row) => total + amount(row[field]), 0));
  const pendingGross = round(open.reduce((total, row) => total + Math.abs(amount(row.amount)), 0));
  const direct = source("direct_commission_spent"), weekly = source("weekly_bonus_spent"), nodeRoi = source("node_roi_spent");
  return {
    date, timezone: "America/Mexico_City", isWednesday: new Date(`${date}T12:00:00Z`).getUTCDay() === 3,
    incoming: { crypto: round(crypto.reduce((sum, row) => sum + amount(row.amount), 0)), cryptoCount: crypto.length,
      manual: round(manual.reduce((sum, row) => sum + amount(row.amount), 0)), manualCount: manual.length,
      capitalReturned: round(capital.reduce((sum, row) => sum + amount(row.amount), 0)), capitalCount: capital.length,
      other: round(other.reduce((sum, row) => sum + amount(row.amount), 0)), otherCount: other.length },
    withdrawalRequests: { count: dayWithdrawals.length, gross: round(dayWithdrawals.reduce((sum, row) => sum + Math.abs(amount(row.amount)), 0)) },
    outstanding: { count: open.length, gross: pendingGross, net: round(open.reduce((sum, row) => sum + Math.max(0, amount(row.net_amount)), 0)), direct, weekly, nodeRoi, unallocated: round(Math.max(0, pendingGross - direct - weekly - nodeRoi)) },
    commissions: { direct: round(credited.filter(row => row.commission_type === "direct").reduce((sum, row) => sum + amount(row.amount), 0)),
      other: round(credited.filter(row => row.commission_type !== "direct").reduce((sum, row) => sum + amount(row.amount), 0)) },
    cancelledNodes: contracts.filter(row => row.status === "cancelled" && mexicoDay(row.updated_at) === date).length,
  };
}

export function registerDailyReconciliationRoutes(app: Express) {
  app.get("/api/admin/daily-reconciliation", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const isRange = req.query.from !== undefined || req.query.to !== undefined;
      const from = String(isRange ? req.query.from || "" : req.query.date || "");
      const to = String(isRange ? req.query.to || "" : from);
      const dates = reconciliationDates(from, to);
      if (!dates) return res.status(400).json({ error: "Elige fechas válidas en un período de hasta 31 días." });
      const earliest = new Date(`${from}T00:00:00Z`); earliest.setUTCDate(earliest.getUTCDate() - 1);
      const latest = new Date(`${to}T00:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 2);
      const allRows = async <T,>(table: string, select: string, filters: (query: any) => any): Promise<T[]> => {
        const rows: T[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await filters(admin.client.from(table).select(select)).order("created_at", { ascending: true }).range(from, from + 999);
          if (error) throw error;
          rows.push(...((data ?? []) as T[]));
          if ((data ?? []).length < 1000) return rows;
        }
      };
      const transactionSelect = "id,type,status,amount,net_amount,provider_status,provider_payment_id,created_at,direct_commission_spent,weekly_bonus_spent,node_roi_spent";
      const [dailyTransactions, pendingTransactions, commissions, cancelledNodes, capitalClaims] = await Promise.all([
        allRows<Transaction>("transactions", transactionSelect, q => q.gte("created_at", earliest.toISOString()).lt("created_at", latest.toISOString())),
        isRange ? Promise.resolve([] as Transaction[]) : allRows<Transaction>("transactions", transactionSelect, q => q.eq("type", "withdraw").in("status", ["pending", "approved"])),
        allRows<Commission>("commission_ledger", "commission_type,amount,status,created_at", q => q.gte("created_at", earliest.toISOString()).lt("created_at", latest.toISOString()).eq("status", "credited")),
        (async () => {
          const rows: Contract[] = [];
          for (let from = 0; ; from += 1000) {
            const { data, error } = await admin.client.from("contracts").select("id,amount,status,updated_at").eq("status", "cancelled").gte("updated_at", earliest.toISOString()).lt("updated_at", latest.toISOString()).order("updated_at", { ascending: true }).range(from, from + 999);
            if (error) throw error;
            rows.push(...((data ?? []) as Contract[]));
            if ((data ?? []).length < 1000) return rows;
          }
        })(),
        (async () => {
          const { data, error } = await admin.client.from("finite_node_capital_choices")
            .select("contract_id,amount,net_amount,status,requested_at")
            .eq("action", "claim")
            .gte("requested_at", earliest.toISOString()).lt("requested_at", latest.toISOString());
          if (error && error.code !== "PGRST205") throw error;
          const current = (data || []) as Array<{ contract_id: string; amount: number; net_amount: number; status: string; requested_at: string }>;
          if (!isRange) {
            const { data: pending, error: pendingError } = await admin.client.from("finite_node_capital_choices")
              .select("contract_id,amount,net_amount,status,requested_at")
              .eq("action", "claim").in("status", ["pending", "approved"]);
            if (pendingError && pendingError.code !== "PGRST205") throw pendingError;
            for (const item of (pending || []) as typeof current) if (!current.some(row => row.contract_id === item.contract_id)) current.push(item);
          }
          return current.map(row => ({
            id: `CAPITAL-CLAIM-${row.contract_id}`, type: "withdraw", status: row.status,
            amount: -Number(row.amount), net_amount: row.net_amount, provider_status: "finite_capital_claim",
            provider_payment_id: null, created_at: row.requested_at,
            direct_commission_spent: 0, weekly_bonus_spent: 0, node_roi_spent: 0,
          } satisfies Transaction));
        })(),
      ]);
      dailyTransactions.push(...capitalClaims.filter(row => mexicoDay(row.created_at) >= from && mexicoDay(row.created_at) <= to));
      const transactions = [...dailyTransactions, ...pendingTransactions.filter(row => !dailyTransactions.some(day => day.id === row.id)), ...capitalClaims.filter(row => !dailyTransactions.some(day => day.id === row.id))];
      if (isRange) {
        const days = dates.map(day => {
          const { outstanding: _snapshot, ...daily } = buildDailyReconciliation(day, dailyTransactions, commissions, cancelledNodes);
          return daily;
        });
        return res.status(200).json({ from, to, timezone: "America/Mexico_City", days });
      }
      return res.status(200).json(buildDailyReconciliation(from, transactions, commissions, cancelledNodes));
    } catch (error) {
      console.error("[admin-daily-reconciliation]", error);
      return res.status(503).json({ error: "No se pudo cargar el cuadre diario." });
    }
  });
}
