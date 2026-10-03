import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

const apiUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";
export const SARA_IA_LAUNCH_AT = "2026-10-05T00:00:00-04:00";
export const saraIaHasLaunched = (at = Date.now()) => at >= Date.parse(SARA_IA_LAUNCH_AT);
const validSaraCurrency = (value: unknown) => {
  const currency = String(value || "").toLowerCase();
  return currency === "usdttrc20" || currency === "usdtbsc" ? currency : null;
};

function adminClient() {
  return apiUrl && serviceKey
    ? createClient(apiUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
}

function bearer(req: Request) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export async function hasActiveSaraNode(
  admin: NonNullable<ReturnType<typeof adminClient>>,
  userId: string
) {
  const { data, error } = await admin
    .from("contracts")
    .select("id,plans!inner(duration_days,active)")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("plans.duration_days", 21)
    .eq("plans.active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("No se pudo verificar tu nodo de 21 días.");
  return Boolean(data);
}

async function authenticatedUser(req: Request) {
  const token = bearer(req);
  const admin = adminClient();
  if (!token || !admin) return { admin: null, user: null };
  try {
    const { data, error } = await admin.auth.getUser(token);
    return { admin, user: error ? null : data.user };
  } catch {
    return { admin: null, user: null };
  }
}

export function registerSaraIaRoutes(app: Express) {
  app.get("/api/sara-ia/status", async (req: Request, res: Response) => {
    try {
      const { admin, user } = await authenticatedUser(req);
      if (!admin || !user)
        return res
          .status(401)
          .json({ error: "Inicia sesión para consultar SARA IA." });
      const [
        { data: subscription, error: subscriptionError },
        { data: payments, error: paymentsError },
        hasActive21DayNode,
      ] = await Promise.all([
        admin
          .from("sara_ia_subscriptions")
          .select("paid_through_at")
          .eq("user_id", user.id)
          .maybeSingle(),
        admin
          .from("sara_ia_payments")
          .select(
            "order_id,status,provider_status,pay_currency,created_at,completed_at"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5),
        hasActiveSaraNode(admin, user.id),
      ]);
      if (subscriptionError || paymentsError)
        return res.status(503).json({
          error: "SARA IA todavía no está disponible en la base de datos.",
        });
      const paidThrough = subscription?.paid_through_at
        ? new Date(subscription.paid_through_at)
        : null;
      return res.json({
        launched: saraIaHasLaunched(),
        launchAt: SARA_IA_LAUNCH_AT,
        active: Boolean(
          saraIaHasLaunched() && paidThrough &&
            paidThrough.getTime() > Date.now() &&
            hasActive21DayNode
        ),
        subscriptionPaid: Boolean(
          paidThrough && paidThrough.getTime() > Date.now()
        ),
        paidThroughAt: subscription?.paid_through_at || null,
        hasActive21DayNode,
        payments: payments || [],
      });
    } catch (error) {
      console.error("[SARA IA] status lookup failed", error);
      return res
        .status(500)
        .json({ error: "No se pudo consultar el estado de SARA IA." });
    }
  });

  app.post(
    "/api/payments/nowpayments/sara-ia",
    async (req: Request, res: Response) => {
      try {
        const { admin, user } = await authenticatedUser(req);
        if (!admin || !user)
          return res.status(401).json({ error: "Supabase Auth requerida." });
        if (!saraIaHasLaunched())
          return res.status(409).json({ error: "SARA IA estará disponible el lunes 5 de octubre de 2026 (hora de Santo Domingo)." });
        if (!apiKey)
          return res
            .status(503)
            .json({ error: "NOWPayments no está configurado." });
        const payCurrency = validSaraCurrency(
          req.body?.payCurrency || "usdtbsc"
        );
        if (!payCurrency)
          return res
            .status(400)
            .json({ error: "Elige USDT por TRC20 o BEP20." });
        if (!(await hasActiveSaraNode(admin, user.id)))
          return res.status(409).json({
            error:
              "Regla de oro: necesitas un nodo de 21 días activo para contratar SARA IA.",
          });

        const orderId = `SARA-${crypto.randomUUID()}`;
        const { error: insertError } = await admin
          .from("sara_ia_payments")
          .insert({
            order_id: orderId,
            user_id: user.id,
            price_amount: 25,
            price_currency: "usd",
            pay_currency: payCurrency,
            status: "pending",
            provider_status: "creating",
          });
        if (insertError)
          return res
            .status(503)
            .json({ error: "No se pudo preparar el pago de SARA IA." });

        const forwardedProto = String(
          req.headers["x-forwarded-proto"] || "https"
        ).split(",")[0];
        const callbackUrl = `${forwardedProto}://${req.get("host")}/api/payments/nowpayments/ipn`;
        try {
          const response = await fetch(`${NOWPAYMENTS_API_URL}/payment`, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              price_amount: 25,
              price_currency: "usd",
              pay_currency: payCurrency,
              order_id: orderId,
              order_description: "BitNode SARA IA · 30 días calendario",
              ipn_callback_url: callbackUrl,
              is_fixed_rate: true,
            }),
          });
          const payment = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          if (
            !response.ok ||
            !payment.payment_id ||
            !payment.pay_address ||
            !payment.pay_amount ||
            String(payment.pay_currency || "").toLowerCase() !== payCurrency
          ) {
            await admin
              .from("sara_ia_payments")
              .update({
                status: "failed",
                provider_status: "invoice_creation_failed",
              })
              .eq("order_id", orderId);
            return res.status(502).json({
              error:
                "NOWPayments no confirmó los datos de pago USDT esperados.",
            });
          }
          const { error: updateError } = await admin
            .from("sara_ia_payments")
            .update({
              provider_payment_id: String(payment.payment_id),
              expected_pay_amount: String(payment.pay_amount),
              provider_status: String(payment.payment_status || "waiting"),
            })
            .eq("order_id", orderId)
            .eq("status", "pending");
          if (updateError)
            return res
              .status(503)
              .json({ error: "No se pudo guardar la referencia del pago." });
          return res.json({
            orderId,
            paymentId: String(payment.payment_id),
            payAddress: String(payment.pay_address),
            payAmount: String(payment.pay_amount),
            payCurrency,
            status: String(payment.payment_status || "waiting"),
          });
        } catch (error) {
          console.error("[SARA IA] payment creation failed", error);
          await admin
            .from("sara_ia_payments")
            .update({
              status: "failed",
              provider_status: "invoice_creation_error",
            })
            .eq("order_id", orderId);
          return res
            .status(502)
            .json({ error: "No se pudo crear el pago en NOWPayments." });
        }
      } catch (error) {
        console.error("[SARA IA] payment setup failed", error);
        return res
          .status(500)
          .json({ error: "No se pudo iniciar la activación de SARA IA." });
      }
    }
  );
}

export async function processSaraIaIpn(
  admin: ReturnType<typeof adminClient>,
  body: Record<string, unknown>
) {
  if (!admin)
    return { handled: false, error: "Persistencia Supabase no configurada." };
  const orderId = body.order_id ? String(body.order_id) : "";
  if (!orderId.startsWith("SARA-")) return { handled: false };
  const { data: payment, error } = await admin
    .from("sara_ia_payments")
    .select("order_id,provider_payment_id,pay_currency,status")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error)
    return { handled: true, error: "No se pudo consultar el pago de SARA IA." };
  if (!payment)
    return { handled: true, error: "Pago de SARA IA no encontrado." };
  const paymentId = String(body.payment_id || "");
  if (
    paymentId &&
    payment.provider_payment_id &&
    paymentId !== payment.provider_payment_id
  ) {
    return {
      handled: true,
      error: "El pago no corresponde a la orden de SARA IA.",
    };
  }
  const providerStatus = String(body.payment_status || "unknown").toLowerCase();
  if (providerStatus === "finished") {
    const price = Number(body.price_amount);
    const priceCurrency = String(body.price_currency || "").toLowerCase();
    const payCurrency = String(body.pay_currency || "").toLowerCase();
    const actuallyPaid = Number(body.actually_paid);
    if (payment.status === "completed") return { handled: true, ok: true };
    if (
      !Number.isFinite(price) ||
      price !== 25 ||
      priceCurrency !== "usd" ||
      payCurrency !== payment.pay_currency ||
      !Number.isFinite(actuallyPaid)
    ) {
      await admin
        .from("sara_ia_payments")
        .update({ status: "review", provider_status: "finished_mismatch" })
        .eq("order_id", orderId)
        .eq("status", "pending");
      return { handled: true, ok: true };
    }
    const { data: result, error: rpcError } = await admin.rpc(
      "complete_sara_ia_payment",
      {
        p_order_id: orderId,
        p_payment_id: paymentId,
        p_pay_currency: payCurrency,
        p_price_amount: price,
        p_actually_paid: actuallyPaid,
      }
    );
    if (rpcError)
      return {
        handled: true,
        error: "No se pudo activar la suscripción de SARA IA.",
      };
    return {
      handled: true,
      ok: ["completed", "already_completed", "review_required"].includes(
        String(result?.status)
      ),
    };
  }
  if (
    ["failed", "expired", "refunded", "partially_paid"].includes(providerStatus)
  ) {
    const status = providerStatus === "refunded" ? "review" : "failed";
    const { error: updateError } = await admin
      .from("sara_ia_payments")
      .update({ status, provider_status: providerStatus })
      .eq("order_id", orderId)
      .eq("status", "pending");
    if (updateError)
      return {
        handled: true,
        error: "No se pudo actualizar el estado del pago.",
      };
  } else {
    await admin
      .from("sara_ia_payments")
      .update({ provider_status: providerStatus })
      .eq("order_id", orderId)
      .eq("status", "pending");
  }
  return { handled: true, ok: true };
}
