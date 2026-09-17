import type { Express } from "express";
import { authenticatedAdmin } from "./adminWithdrawals.js";

export type ActivationTransaction = {
  id: string;
  user_id: string | null;
  username: string | null;
  type: string;
  status: string;
  amount: number | string;
  created_at: string;
  provider_status: string | null;
  provider_payment_id: string | null;
};

export function buildActivationReport(rows: ActivationTransaction[]) {
  const accounts = new Map<string, { userId: string; username: string | null; firstActivation: string; contracts: number; activatedAmount: number; cryptoDeposits: number; manualDeposits: number; otherDeposits: number; origin: "crypto" | "manual" | "mixed" | "unverified" }>();
  const deposits = new Map<string, ActivationTransaction[]>();
  for (const row of rows) {
    if (row.user_id && row.type === "deposit" && row.status === "completed") {
      const list = deposits.get(row.user_id) ?? [];
      list.push(row);
      deposits.set(row.user_id, list);
    }
  }
  for (const row of rows.filter(item => item.user_id && item.type === "contract" && item.status === "completed").sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const id = row.user_id!;
    const existing = accounts.get(id);
    if (existing) {
      existing.contracts++;
      existing.activatedAmount += Math.abs(Number(row.amount) || 0);
      continue;
    }
    const prior = (deposits.get(id) ?? []).filter(item => item.created_at <= row.created_at);
    let cryptoDeposits = 0, manualDeposits = 0, otherDeposits = 0;
    for (const deposit of prior) {
      if (deposit.provider_status?.startsWith("promo_cashback:")) continue;
      const amount = Math.max(0, Number(deposit.amount) || 0);
      if (deposit.id.startsWith("NP-") && deposit.provider_payment_id && ["finished", "confirmed"].includes(deposit.provider_status || "")) cryptoDeposits += amount;
      else if (deposit.id.startsWith("ADMIN-") && deposit.provider_status?.startsWith("admin_manual:")) manualDeposits += amount;
      else otherDeposits += amount;
    }
    const origin = cryptoDeposits && !manualDeposits && !otherDeposits ? "crypto" : manualDeposits && !cryptoDeposits && !otherDeposits ? "manual" : cryptoDeposits || manualDeposits ? "mixed" : "unverified";
    accounts.set(id, { userId: id, username: row.username, firstActivation: row.created_at, contracts: 1, activatedAmount: Math.abs(Number(row.amount) || 0), cryptoDeposits, manualDeposits, otherDeposits, origin });
  }
  return Array.from(accounts.values()).sort((a, b) => b.firstActivation.localeCompare(a.firstActivation));
}

export function registerActivationReportRoutes(app: Express) {
  app.get("/api/admin/activation-report", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const admin = await authenticatedAdmin(req);
      if ("error" in admin) return res.status(admin.status ?? 500).json({ error: admin.error });
      const rows: ActivationTransaction[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await admin.client.from("transactions")
          .select("id,user_id,username,type,status,amount,created_at,provider_status,provider_payment_id")
          .in("type", ["contract", "deposit"])
          .in("status", ["completed"])
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as ActivationTransaction[]));
        if ((data ?? []).length < pageSize) break;
      }
      return res.status(200).json({ accounts: buildActivationReport(rows), updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error("[admin-activation-report]", error);
      return res.status(503).json({ error: "No se pudo cargar el reporte de activaciones." });
    }
  });
}
