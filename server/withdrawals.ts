import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

const NETWORKS = new Set(["BNB Chain"]);
const LIMIT = 1000;
const FEE_RATE = 0.015;

function admin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function token(req: Request) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export function validWallet(network: string, wallet: string) {
  return network === "BNB Chain" && /^0x[a-fA-F0-9]{40}$/.test(wallet);
}

export function validateWithdrawalInput(amount: number, network: string, wallet: string, usedToday: number) {
  if (!Number.isFinite(amount) || amount < 10 || amount > LIMIT) return "El retiro debe estar entre $10 y $1,000 USDT.";
  if (!NETWORKS.has(network) || !validWallet(network, wallet)) return "La red o la wallet no son válidas.";
  if (usedToday + amount > LIMIT) return `Límite diario excedido. Ya solicitaste ${usedToday.toFixed(2)} USDT hoy.`;
  return null;
}

export function registerWithdrawalRoutes(app: Express) {
  app.post("/api/withdrawals/request", async (req: Request, res: Response) => {
    const client = admin();
    const accessToken = token(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesión Supabase requerida." });
    const { data, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !data.user) return res.status(401).json({ error: "Sesión Supabase inválida." });

    const amount = Number(req.body?.amount);
    const network = String(req.body?.network || "");
    const wallet = String(req.body?.wallet || "").trim();
    const fee = Math.max(1, amount * FEE_RATE);
    const basicError = validateWithdrawalInput(amount, network, wallet, 0);
    if (basicError) return res.status(400).json({ error: basicError });

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { data: today, error: historyError } = await client.from("transactions").select("amount,type").eq("user_id", data.user.id).eq("type", "withdraw").gte("created_at", start.toISOString());
    if (historyError) return res.status(500).json({ error: "No se pudo verificar el límite diario." });
    const used = (today || []).reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
    const limitError = validateWithdrawalInput(amount, network, wallet, used);
    if (limitError) return res.status(400).json({ error: limitError });

    const id = `WDR-${crypto.randomUUID()}`;
    const { error: insertError } = await client.from("transactions").insert({
      id,
      user_id: data.user.id,
      username: data.user.user_metadata?.username || data.user.email?.split("@")[0] || null,
      type: "withdraw",
      label: `Solicitud de retiro · ${network}`,
      amount: -amount,
      status: "pending",
      network,
      wallet,
      fee,
      net_amount: amount - fee,
      created_at: new Date().toISOString(),
      provider_status: "manual_review",
    });
    if (insertError) return res.status(500).json({ error: "No se pudo registrar la solicitud de retiro." });
    return res.status(201).json({ id, status: "pending", fee, netAmount: amount - fee, message: "Solicitud registrada. El retiro se procesa manualmente hasta en 48 horas." });
  });
}
