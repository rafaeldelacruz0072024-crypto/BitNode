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

export function buildDailyReconciliation(date: string, transactions: Transaction[], commissions: Commission[], contracts: Contract[]) {
  const daily = transactions.filter(row => mexicoDay(row.created_at) === date);
  const open = transactions.filter(row => row.type === "withdraw" && ["pending", "approved"].includes(row.status));
  const dayWithdrawals = daily.filter(row => row.type === "withdraw");
  const crypto = daily.filter(row => row.type === "deposit" && row.status === "completed" && row.id.startsWith("NP-") && row.provider_payment_id && ["finished", "confirmed"].includes(row.provider_status || ""));
  const manual = daily.filter(row => row.type === "deposit" && row.status === "completed" && row.id.startsWith("ADMIN-") && row.provider_status?.startsWith("admin_manual:"));
  const capital = daily.filter(row => row.type === "deposit" && row.status === "completed" && (row.id.startsWith("DAILY-CAPITAL-") || row.id.startsWith("PRINCIPAL-")));
  const other = daily.filter(row => row.type === "deposit" && row.status === "completed" && !crypto.includes(row) && !manual.includes(row) && !capital.includes(row) && !row.provider_status?.startsWith("promo_cashback:"));
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
      const date = String(req.query.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) return res.status(400).json({ error: "Fecha inválida." });
      const earliest = new Date(`${date}T00:00:00Z`); earliest.setUTCDate(earliest.getUTCDate() - 1);
      const latest = new Date(`${date}T00:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 2);
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
      const [dailyTransactions, pendingTransactions, commissions, cancelledNodes] = await Promise.all([
        allRows<Transaction>("transactions", transactionSelect, q => q.gte("created_at", earliest.toISOString()).lt("created_at", latest.toISOString())),
        allRows<Transaction>("transactions", transactionSelect, q => q.eq("type", "withdraw").in("status", ["pending", "approved"])),
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
      ]);
      const transactions = [...dailyTransactions, ...pendingTransactions.filter(row => !dailyTransactions.some(day => day.id === row.id))];
      return res.status(200).json(buildDailyReconciliation(date, transactions, commissions, cancelledNodes));
    } catch (error) {
      console.error("[admin-daily-reconciliation]", error);
      return res.status(503).json({ error: "No se pudo cargar el cuadre diario." });
    }
  });
}
