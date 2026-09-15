import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

const NETWORKS = new Set(["BNB Chain"]);
const LIMIT = 1000;

function admin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function token(req: Request) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

function challengeHash(challengeId: string, nonce: string) {
  const secret = process.env.EMAIL_OTP_SECRET || process.env.RESEND_API_KEY || "";
  return crypto.createHmac("sha256", secret).update(`${challengeId}:${nonce}`).digest("hex");
}

export function validWallet(network: string, wallet: string) {
  return network === "BNB Chain" && /^0x[a-fA-F0-9]{40}$/.test(wallet);
}

export function validateWithdrawalInput(amount: number, network: string, wallet: string, usedToday: number) {
  if (!Number.isFinite(amount) || amount < 10 || amount > LIMIT) return "El retiro debe estar entre $10 y $1,000 USDT.";
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) return "El monto debe tener hasta dos decimales.";
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
    const lockedWallet = String(data.user.app_metadata?.withdrawal_wallet_bep20 || data.user.user_metadata?.wallet_bep20 || "").trim();
    if (!lockedWallet) return res.status(400).json({ error: "Guarda primero tu wallet de retiro en Perfil." });
    if (wallet.toLowerCase() !== lockedWallet.toLowerCase()) return res.status(409).json({ error: "Debes retirar hacia tu wallet registrada. Contacta a soporte para cambiarla." });
    const basicError = validateWithdrawalInput(amount, network, wallet, 0);
    if (basicError) return res.status(400).json({ error: basicError });

    const { error: validationError } = await client.rpc("validate_withdrawal_request", {
      p_user_id: data.user.id, p_amount: amount,
    });
    if (validationError) {
      if (validationError.code === "P0001") return res.status(400).json({ error: validationError.message });
      return res.status(500).json({ error: "No se pudo validar la solicitud de retiro." });
    }

    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomBytes(32).toString("hex");
    const codeHash = challengeHash(challengeId, nonce);
    const { error: challengeError } = await client.from("email_security_challenges").insert({
      id: challengeId, user_id: data.user.id, purpose: "withdrawal", code_hash: codeHash,
      payload: { amount, network, wallet }, expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    });
    if (challengeError) return res.status(500).json({ error: "No se pudo registrar la solicitud de retiro." });

    const { data: result, error } = await client.rpc("confirm_verified_withdrawal", {
      p_user_id: data.user.id, p_challenge_id: challengeId, p_code_hash: codeHash,
    });
    if (error) {
      await client.from("email_security_challenges").delete().eq("id", challengeId).is("consumed_at", null);
      if (error.code === "P0001") return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: "No se pudo registrar la solicitud de retiro." });
    }
    await client.from("transactions").update({ provider_status: "session_verified" }).eq("id", result.id).eq("status", "pending");
    return res.status(201).json(result);
  });
}
