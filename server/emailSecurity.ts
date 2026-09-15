import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { validateWithdrawalInput } from "./withdrawals.js";

type Purpose = "withdrawal" | "wallet_change";
const CODE_TTL_MS = 10 * 60 * 1000;

function admin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function bearer(req: Request) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
function digest(challengeId: string, code: string) {
  const secret = process.env.EMAIL_OTP_SECRET || process.env.RESEND_API_KEY || "";
  return crypto.createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c] || c);
}
async function sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY no está configurada.");
  const from = process.env.RESEND_FROM_EMAIL || "BitNode <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok) throw new Error(body.message || `Resend respondió ${response.status}.`);
  return body.id || null;
}
async function authenticated(req: Request) {
  const client = admin(); const token = bearer(req);
  if (!client || !token) return null;
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user?.email ? null : { client, user: data.user };
}
function normalizedPayload(purpose: Purpose, input: unknown) {
  const payload = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (purpose === "wallet_change") {
    const wallet = String(payload.wallet || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error("La wallet BEP20 no es válida.");
    return { wallet };
  }
  const amount = Number(payload.amount); const network = String(payload.network || ""); const wallet = String(payload.wallet || "").trim();
  const error = validateWithdrawalInput(amount, network, wallet, 0);
  if (error) throw new Error(error);
  return { amount, network, wallet };
}

function withdrawalError(res: Response, error: { code?: string; message: string }) {
  if (error.code !== "P0001") return res.status(503).json({ error: "No se pudo verificar el retiro. Intenta nuevamente." });
  return res.status(error.message.includes("ventana") ? 423 : 400).json({ error: error.message });
}

export function registerEmailSecurityRoutes(app: Express) {
  app.post("/api/security/wallet", async (req: Request, res: Response) => {
    const auth = await authenticated(req);
    if (!auth) return res.status(401).json({ error: "Sesión Supabase requerida." });
    const wallet = String(req.body?.wallet || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: "La wallet BEP20 no es válida." });
    const lockedWallet = String(auth.user.app_metadata?.withdrawal_wallet_bep20 || auth.user.user_metadata?.wallet_bep20 || "").trim();
    if (lockedWallet && lockedWallet.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(409).json({ error: "La wallet ya está bloqueada. Solicita el cambio a soporte." });
    }
    const { error } = await auth.client.auth.admin.updateUserById(auth.user.id, {
      user_metadata: { ...auth.user.user_metadata, wallet_bep20: wallet },
      app_metadata: { ...auth.user.app_metadata, withdrawal_wallet_bep20: wallet },
    });
    if (error) return res.status(500).json({ error: "No se pudo guardar la wallet." });
    return res.json({ status: "saved", message: "Wallet guardada correctamente." });
  });

  app.post("/api/security/email-code/request", async (req: Request, res: Response) => {
    const auth = await authenticated(req);
    if (!auth) return res.status(401).json({ error: "Sesión Supabase requerida." });
    const purpose = String(req.body?.purpose || "") as Purpose;
    if (purpose !== "withdrawal" && purpose !== "wallet_change") return res.status(400).json({ error: "Operación no válida." });
    try {
      const payload = normalizedPayload(purpose, req.body?.payload);
      if (purpose === "withdrawal") {
        const { error } = await auth.client.rpc("validate_withdrawal_request", {
          p_user_id: auth.user.id, p_amount: "amount" in payload ? payload.amount : 0,
        });
        if (error) return withdrawalError(res, error);
      }
      const recentSince = new Date(Date.now() - 60_000).toISOString();
      const { count } = await auth.client.from("email_security_challenges").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).gte("created_at", recentSince);
      if ((count || 0) > 0) return res.status(429).json({ error: "Espera un minuto antes de solicitar otro código." });
      const id = crypto.randomUUID(); const code = crypto.randomInt(100000, 1000000).toString();
      const { error } = await auth.client.from("email_security_challenges").insert({ id, user_id: auth.user.id, purpose, code_hash: digest(id, code), payload, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() });
      if (error) throw error;
      const action = purpose === "withdrawal" ? "confirmar tu retiro" : "confirmar tu wallet de retiro";
      try {
        await sendEmail(auth.user.email!, `Código BitNode: ${code}`, `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#0b1020;color:#eef2ff;border-radius:14px"><h1 style="color:#9badff">BitNode</h1><p>Usa este código para ${action}:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700">${code}</p><p>Caduca en 10 minutos. Si no solicitaste esta acción, ignora este mensaje.</p></div>`, `otp-${id}`);
      } catch (error) {
        await auth.client.from("email_security_challenges").delete().eq("id", id);
        throw error;
      }
      return res.json({ challengeId: id, expiresInSeconds: 600, maskedEmail: auth.user.email!.replace(/^(.{2}).*(@.*)$/, "$1***$2") });
    } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo enviar el código." }); }
  });

  app.post("/api/security/email-code/verify", async (req: Request, res: Response) => {
    const auth = await authenticated(req);
    if (!auth) return res.status(401).json({ error: "Sesión Supabase requerida." });
    const challengeId = String(req.body?.challengeId || ""); const code = String(req.body?.code || "").trim();
    const { data: challenge } = await auth.client.from("email_security_challenges").select("*").eq("id", challengeId).eq("user_id", auth.user.id).maybeSingle();
    if (!challenge || (challenge.purpose !== "withdrawal" && challenge.consumed_at) || (!challenge.consumed_at && new Date(challenge.expires_at).getTime() < Date.now())) return res.status(400).json({ error: "El código expiró o ya fue utilizado." });
    if (challenge.attempts >= 5) return res.status(429).json({ error: "Se agotaron los intentos. Solicita otro código." });
    if (!/^\d{6}$/.test(code) || !safeEqual(challenge.code_hash, digest(challengeId, code))) {
      await auth.client.from("email_security_challenges").update({ attempts: challenge.attempts + 1 }).eq("id", challengeId);
      return res.status(400).json({ error: "Código incorrecto." });
    }
    if (challenge.purpose === "withdrawal") {
      const { data: result, error } = await auth.client.rpc("confirm_verified_withdrawal", {
        p_user_id: auth.user.id, p_challenge_id: challengeId, p_code_hash: digest(challengeId, code),
      });
      if (error) return withdrawalError(res, error);
      if (!result?.id) return res.status(503).json({ error: "No se pudo verificar el retiro." });
      await sendEmail(auth.user.email!, "Retiro confirmado en BitNode", `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px"><h1>Retiro confirmado</h1><p>Solicitud: <b>${escapeHtml(result.id)}</b></p><p>Monto reservado: <b>${Number(result.amount).toFixed(2)} USDT</b></p><p>Comisión: ${Number(result.fee).toFixed(2)} USDT · Neto: ${Number(result.netAmount).toFixed(2)} USDT</p><p>Wallet: ${escapeHtml(result.wallet)}</p></div>`, `withdrawal-confirmed-${result.id}`).catch(() => undefined);
      return res.status(201).json(result);
    }
    const { data: consumed } = await auth.client.from("email_security_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challengeId).is("consumed_at", null).select("id").maybeSingle();
    if (!consumed) return res.status(409).json({ error: "Este código ya fue utilizado." });
    const payload = challenge.payload as Record<string, unknown>;
    if (challenge.purpose === "wallet_change") {
      const { error } = await auth.client.auth.admin.updateUserById(auth.user.id, { user_metadata: { ...auth.user.user_metadata, wallet_bep20: String(payload.wallet) } });
      if (error) return res.status(500).json({ error: "No se pudo guardar la wallet." });
      return res.json({ status: "verified", message: "Wallet confirmada y guardada." });
    }
    return res.status(400).json({ error: "Operación no válida." });
  });

  app.post("/api/email/welcome", async (req: Request, res: Response) => {
    const auth = await authenticated(req); if (!auth) return res.status(401).json({ error: "Sesión requerida." });
    const { data: existing } = await auth.client.from("transactional_email_events").select("id").eq("user_id", auth.user.id).eq("kind", "welcome").maybeSingle();
    if (existing) return res.json({ status: "already_sent" });
    try {
      const name = escapeHtml(String(auth.user.user_metadata?.username || auth.user.email!.split("@")[0]));
      const providerId = await sendEmail(auth.user.email!, "Bienvenido a BitNode", `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#0b1020;color:#eef2ff;border-radius:14px"><h1 style="color:#9badff">Bienvenido a BitNode, ${name}</h1><p>Tu correo fue confirmado y tu cuenta ya está lista.</p><p>Desde tu dashboard puedes activar nodos, completar tareas y administrar tus retiros con verificación por correo.</p></div>`, `welcome-${auth.user.id}`);
      await auth.client.from("transactional_email_events").insert({ user_id: auth.user.id, kind: "welcome", provider_id: providerId });
      return res.json({ status: "sent" });
    } catch { return res.status(503).json({ error: "No se pudo enviar el correo de bienvenida." }); }
  });
}
