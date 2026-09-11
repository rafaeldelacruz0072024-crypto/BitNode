import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { DEPOSIT_CASHBACK_START, depositCashback, depositCashbackTransactionId } from "@shared/depositCashback";

const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";
export const SUPPORTED_DEPOSIT_CURRENCIES = new Set(["usdttrc20", "usdtbsc"]);
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function origin(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${forwardedProto}://${req.get("host")}`;
}

function bearer(req: Request) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = sortObject((value as Record<string, unknown>)[key]);
    return result;
  }, {});
}

export function validIpnSignature(body: unknown, signature: string | undefined) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signature) return false;
  const digest = crypto.createHmac("sha512", secret).update(JSON.stringify(sortObject(body))).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const received = Buffer.from(signature, "utf8");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export function validDepositCurrency(value: unknown) {
  const currency = String(value || "").toLowerCase();
  return SUPPORTED_DEPOSIT_CURRENCIES.has(currency) ? currency : null;
}

export function depositCashbackEntry(deposit: { id: string; user_id: string; username?: string | null; amount: number; network?: string | null; created_at: string }) {
  const createdAt = new Date(deposit.created_at).getTime();
  if (!Number.isFinite(createdAt) || createdAt < DEPOSIT_CASHBACK_START) return null;
  const cashback = depositCashback(Number(deposit.amount));
  if (cashback.amount <= 0) return null;
  return { id: depositCashbackTransactionId(deposit.id), user_id: deposit.user_id, username: deposit.username, type: "deposit", label: `Cashback promocional ${cashback.rate * 100}%`, amount: cashback.amount, status: "completed", network: deposit.network, provider_status: `promo_cashback:${deposit.id}` };
}

export function registerNowPaymentsRoutes(app: Express) {
  app.post("/api/payments/nowpayments/payment", async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.NOWPAYMENTS_API_KEY;
      const admin = adminClient();
      const token = bearer(req);
      if (!apiKey || !admin || !token) return res.status(401).json({ error: "Supabase Auth requerida." });
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData.user) return res.status(401).json({ error: "Sesión Supabase inválida." });

      const amount = Number(req.body?.amount);
      const payCurrency = validDepositCurrency(req.body?.payCurrency || "usdtbsc");
      if (!Number.isFinite(amount) || amount < 10 || amount > 100000) return res.status(400).json({ error: "El monto debe estar entre 10 y 100000 USD." });
      if (!payCurrency) return res.status(400).json({ error: "Solo se permiten depósitos USDT por TRC20 o BEP20." });

      const transactionId = `NP-${crypto.randomUUID()}`;
      const callbackUrl = `${origin(req)}/api/payments/nowpayments/ipn`;
      const response = await fetch(`${NOWPAYMENTS_API_URL}/payment`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          price_amount: amount,
          price_currency: "usd",
          pay_currency: payCurrency,
          order_id: transactionId,
          order_description: `BitNode deposit ${authData.user.id}`,
          ipn_callback_url: callbackUrl,
          is_fixed_rate: true,
        }),
      });
      const payment = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(502).json({ error: "NOWPayments rechazó la creación del pago.", details: payment });
      if (!payment.payment_id || !payment.pay_address || !payment.pay_amount || !payment.pay_currency)
        return res.status(502).json({ error: "NOWPayments no devolvió los datos de depósito esperados.", details: payment });

      const { error: insertError } = await admin.from("transactions").insert({
        id: transactionId,
        user_id: authData.user.id,
        username: authData.user.user_metadata?.username || authData.user.email?.split("@")[0] || null,
        type: "deposit",
        label: "Depósito NOWPayments",
        amount,
        status: "pending",
        network: payCurrency,
        provider_payment_id: String(payment.payment_id),
        provider_status: String(payment.payment_status || "waiting"),
        created_at: new Date().toISOString(),
      });
      if (insertError) return res.status(500).json({ error: "No se pudo registrar el depósito.", details: insertError.message });
      return res.json({
        transactionId,
        paymentId: String(payment.payment_id),
        payAddress: String(payment.pay_address),
        payAmount: String(payment.pay_amount),
        payCurrency: String(payment.pay_currency),
        status: String(payment.payment_status || "waiting"),
      });
    } catch (error) {
      console.error("[NOWPayments] payment error", error);
      return res.status(500).json({ error: "No se pudo iniciar el depósito." });
    }
  });

  app.post("/api/payments/nowpayments/ipn", async (req: Request, res: Response) => {
    if (!validIpnSignature(req.body, req.header("x-nowpayments-sig"))) return res.status(401).json({ error: "Firma IPN inválida." });
    const admin = adminClient();
    if (!admin) return res.status(503).json({ error: "Persistencia Supabase no configurada." });
    const body = req.body as Record<string, unknown>;
    const orderId = body.order_id ? String(body.order_id) : "";
    const providerStatus = body.payment_status ? String(body.payment_status) : "unknown";
    const status = ["finished", "confirmed"].includes(providerStatus) ? "completed" : ["failed", "expired", "refunded"].includes(providerStatus) ? "failed" : "pending";
    if (orderId) {
      const { data: deposit, error: lookupError } = await admin.from("transactions").select("id,user_id,username,amount,network,created_at,provider_payment_id").eq("id", orderId).eq("type", "deposit").maybeSingle();
      if (lookupError) return res.status(500).json({ error: "No se pudo consultar la transacción." });
      if (!deposit) return res.status(404).json({ error: "Depósito no encontrado." });
      const paymentId = body.payment_id ? String(body.payment_id) : "";
      if (paymentId && deposit.provider_payment_id && paymentId !== String(deposit.provider_payment_id)) return res.status(409).json({ error: "El pago no corresponde al depósito." });
      const { error } = await admin.from("transactions").update({ status, provider_status: providerStatus, provider_payment_id: paymentId || undefined }).eq("id", orderId).eq("type", "deposit");
      if (error) return res.status(500).json({ error: "No se pudo actualizar la transacción." });
      const cashbackId = depositCashbackTransactionId(orderId);
      if (status === "completed") {
        const cashback = depositCashbackEntry({ ...deposit, amount: Number(deposit.amount), created_at: String(deposit.created_at) });
        if (cashback) {
          const { error: cashbackError } = await admin.from("transactions").upsert({ ...cashback, created_at: new Date().toISOString() }, { onConflict: "id" });
          if (cashbackError) return res.status(500).json({ error: "No se pudo acreditar el cashback." });
        }
      } else if (status === "failed") {
        const { error: reversalError } = await admin.from("transactions").update({ status: "reversed", provider_status: `promo_cashback:reversed:${orderId}` }).eq("id", cashbackId).like("provider_status", "promo_cashback:%");
        if (reversalError) return res.status(500).json({ error: "No se pudo revertir el cashback." });
      }
    }
    return res.json({ received: true });
  });
}
