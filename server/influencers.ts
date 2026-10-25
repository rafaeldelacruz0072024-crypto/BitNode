import type { Express, Request } from "express";
import { createClient } from "@supabase/supabase-js";
import { authenticatedAdmin } from "./adminWithdrawals.js";
import { recordAdminOperation } from "./adminAudit.js";

const BUCKET = "influencer-evidence";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";
const INFLUENCER_CURRENCIES = new Set(["usdttrc20", "usdtbsc"]);

function requestOrigin(req: Request) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.get("host")}`;
}

function serviceClient() {
  return createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });
}

async function authenticatedUser(req: Request) {
  const token = req.headers.authorization?.replace(/^Bearer /i, "") || "";
  if (!token) return { error: "Inicia sesión para continuar.", status: 401 } as const;
  const client = serviceClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { error: "Sesión no válida.", status: 401 } as const;
  return { client, userId: data.user.id, email: data.user.email || null } as const;
}

function safeExtension(name: string) {
  const ext = name.toLowerCase().match(/\.(jpg|jpeg|png|webp|pdf)$/)?.[1];
  return ext === "jpeg" ? "jpg" : ext || "bin";
}

function validStoryUrl(platform: string, value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return platform === "instagram" ? host === "instagram.com" || host.endsWith(".instagram.com") : host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch";
  } catch { return false; }
}

function mexicoWeekStart(value = new Date()) {
  const local = new Date(value.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const day = local.getDay() || 7;
  local.setDate(local.getDate() - day + 1);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

export async function processInfluencerIpn(admin: ReturnType<typeof serviceClient>, body: Record<string, unknown>) {
  const orderId = String(body.order_id || "");
  if (!orderId.startsWith("INFLUENCER-")) return { handled:false } as const;
  const { data: payment, error } = await admin.from("influencer_payments").select("order_id,provider_payment_id,price_amount,pay_amount,pay_currency,status").eq("order_id", orderId).maybeSingle();
  if (error || !payment) return { handled:true, error:"Pago Influencers no encontrado." } as const;
  if (payment.status === "completed") return { handled:true, ok:true } as const;
  const providerStatus = String(body.payment_status || "unknown").toLowerCase();
  const paymentId = String(body.payment_id || "");
  const payCurrency = String(body.pay_currency || "").toLowerCase();
  const priceCurrency = String(body.price_currency || "").toLowerCase();
  const priceAmount = Number(body.price_amount);
  const payAmount = Number(body.pay_amount);
  const actuallyPaid = Number(body.actually_paid || 0);
  const mismatch = !paymentId || paymentId !== payment.provider_payment_id || payCurrency !== payment.pay_currency || priceCurrency !== "usd" || !Number.isFinite(priceAmount) || Math.abs(priceAmount-Number(payment.price_amount)) > .001 || !Number.isFinite(payAmount) || Math.abs(payAmount-Number(payment.pay_amount)) > .00000001;
  if (mismatch) {
    await admin.from("influencer_payments").update({ status:"review", provider_status:providerStatus, actually_paid:Number.isFinite(actuallyPaid)?actuallyPaid:null, updated_at:new Date().toISOString() }).eq("order_id",orderId).neq("status","completed");
    return { handled:true, ok:true } as const;
  }
  if (providerStatus === "finished") {
    if (!Number.isFinite(actuallyPaid) || actuallyPaid + .00000001 < Number(payment.pay_amount)) {
      await admin.from("influencer_payments").update({ status:"review",provider_status:providerStatus,actually_paid:actuallyPaid,updated_at:new Date().toISOString() }).eq("order_id",orderId).neq("status","completed");
      return { handled:true,ok:true } as const;
    }
    const { error: completionError } = await admin.rpc("complete_influencer_nowpayment", { p_order_id:orderId,p_payment_id:paymentId,p_pay_currency:payCurrency,p_price_amount:priceAmount,p_pay_amount:payAmount,p_actually_paid:actuallyPaid });
    return completionError ? { handled:true,error:completionError.message || "No se pudo activar el paquete." } as const : { handled:true,ok:true } as const;
  }
  const failed = ["failed","expired","refunded"].includes(providerStatus);
  await admin.from("influencer_payments").update({ status:failed?"failed":"pending",provider_status:providerStatus,actually_paid:Number.isFinite(actuallyPaid)?actuallyPaid:null,updated_at:new Date().toISOString() }).eq("order_id",orderId).neq("status","completed");
  return { handled:true,ok:true } as const;
}

export function registerInfluencerRoutes(app: Express) {
  app.get("/api/influencers/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { data: packageRow, error } = await auth.client.from("influencer_packages").select("*").eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return res.status(503).json({ error: "El programa aún no está disponible en la base de datos." });
    const { data: submissions } = packageRow ? await auth.client.from("influencer_submissions").select("id,platform,story_url,campaign_code,story_published_at,submitted_at,status,reported_views,verified_views,reward_amount,review_note").eq("package_id", packageRow.id).order("submitted_at", { ascending: false }).limit(30) : { data: [] };
    const weekStart = mexicoWeekStart();
    const weekly = (submissions || []).filter(row => String(row.submitted_at) >= `${weekStart}T00:00:00`).reduce((sum, row) => sum + Number(row.reward_amount || 0), 0);
    const { data: plans } = await auth.client.from("influencer_plans").select("code,name,price,reward_cap,weekly_cap,reward_rate,duration_days").eq("active", true).order("sort_order");
    const { data: payouts } = await auth.client.from("influencer_weekly_payouts").select("id,week_start,week_end,verified_views,amount,status,transaction_id,credited_at").eq("user_id", auth.userId).order("week_start", { ascending: false }).limit(12);
    const { data: payment } = packageRow ? await auth.client.from("influencer_payments").select("order_id,provider_payment_id,price_amount,pay_amount,pay_currency,pay_address,status,provider_status,actually_paid,created_at,completed_at").eq("package_id", packageRow.id).maybeSingle() : { data: null };
    return res.json({ package: packageRow || null, payment: payment || null, plans: plans || [], submissions: submissions || [], payouts: payouts || [], weekStart, weeklyReward: weekly });
  });

  app.post("/api/influencers/purchase", async (req, res) => {
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { planCode, requestId } = req.body || {};
    if (typeof planCode !== "string" || typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) return res.status(400).json({ error: "Solicitud de compra inválida." });
    const { data, error } = await auth.client.rpc("purchase_influencer_plan_from_balance", { p_user_id: auth.userId, p_plan_code: planCode, p_request_id: requestId });
    if (error) return res.status(409).json({ error: error.message || "No se pudo comprar el paquete." });
    return res.status(201).json({ package: data });
  });

  app.post("/api/influencers/request", async (req, res) => {
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { planCode } = req.body || {};
    if (typeof planCode !== "string") return res.status(400).json({ error: "Selecciona un paquete válido." });
    const { data: plan } = await auth.client.from("influencer_plans").select("*").eq("code", planCode).eq("active", true).maybeSingle();
    if (!plan) return res.status(400).json({ error: "El paquete seleccionado no está disponible." });
    const { data: existing } = await auth.client.from("influencer_packages").select("id,status").eq("user_id", auth.userId).in("status", ["pending", "active", "paused"]).maybeSingle();
    if (existing) return res.json({ package: existing });
    const { data, error } = await auth.client.from("influencer_packages").insert({ user_id: auth.userId, plan_code: plan.code, price: plan.price, reward_rate: plan.reward_rate, weekly_cap: plan.weekly_cap, reward_cap: plan.reward_cap }).select("id,status,plan_code").single();
    if (error) return res.status(503).json({ error: error.code === "23505" ? "Ya tienes una solicitud abierta." : "No se pudo registrar la solicitud." });
    return res.status(201).json({ package: data });
  });

  app.post("/api/payments/nowpayments/influencer", async (req, res) => {
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "NOWPayments no está configurado." });
    const { planCode } = req.body || {};
    const payCurrency = String(req.body?.payCurrency || "usdtbsc").toLowerCase();
    if (typeof planCode !== "string" || !INFLUENCER_CURRENCIES.has(payCurrency)) return res.status(400).json({ error: "Selecciona un paquete y una red USDT válida." });
    const { data: plan } = await auth.client.from("influencer_plans").select("code,name,price,reward_rate,weekly_cap,reward_cap").eq("code", planCode).eq("active", true).maybeSingle();
    if (!plan) return res.status(400).json({ error: "El paquete seleccionado no está disponible." });
    let { data: packageRow } = await auth.client.from("influencer_packages").select("id,status,plan_code").eq("user_id", auth.userId).in("status", ["pending","active","paused"]).maybeSingle();
    if (packageRow && packageRow.status !== "pending") return res.status(409).json({ error: "Ya tienes un paquete Influencers activo o pausado." });
    if (packageRow && packageRow.plan_code !== plan.code) return res.status(409).json({ error: "Tu solicitud pendiente corresponde a otro paquete. Administración debe cancelarla antes de cambiar el plan." });
    if (!packageRow) {
      const created = await auth.client.from("influencer_packages").insert({ user_id: auth.userId, plan_code: plan.code, price: plan.price, reward_rate: plan.reward_rate, weekly_cap: plan.weekly_cap, reward_cap: plan.reward_cap }).select("id,status,plan_code").single();
      if (created.error || !created.data) return res.status(409).json({ error: "No se pudo reservar el paquete Influencers." });
      packageRow = created.data;
    }
    const { data: existing } = await auth.client.from("influencer_payments").select("order_id,provider_payment_id,price_amount,pay_amount,pay_currency,pay_address,status,provider_status,actually_paid,created_at,completed_at").eq("package_id", packageRow.id).maybeSingle();
    if (existing) return res.json({ payment: existing, reused: true });
    const orderId = `INFLUENCER-${crypto.randomUUID()}`;
    const response = await fetch(`${NOWPAYMENTS_API_URL}/payment`, { method:"POST", headers:{ "x-api-key":apiKey,"Content-Type":"application/json" }, body:JSON.stringify({ price_amount:Number(plan.price), price_currency:"usd", pay_currency:payCurrency, order_id:orderId, order_description:`BitNode Influencers ${plan.code}`, ipn_callback_url:`${requestOrigin(req)}/api/payments/nowpayments/ipn`, is_fixed_rate:true }) });
    const provider = await response.json().catch(() => ({}));
    if (!response.ok || !provider.payment_id || !provider.pay_address || !provider.pay_amount || String(provider.pay_currency || "").toLowerCase() !== payCurrency) return res.status(502).json({ error: "NOWPayments no confirmó los datos de pago USDT esperados." });
    const payment = { order_id:orderId, package_id:packageRow.id, user_id:auth.userId, provider_payment_id:String(provider.payment_id), price_amount:Number(plan.price), pay_amount:Number(provider.pay_amount), pay_currency:payCurrency, pay_address:String(provider.pay_address), provider_status:String(provider.payment_status || "waiting") };
    const { data, error } = await auth.client.from("influencer_payments").insert(payment).select("order_id,provider_payment_id,price_amount,pay_amount,pay_currency,pay_address,status,provider_status,actually_paid,created_at,completed_at").single();
    if (error || !data) return res.status(500).json({ error: "El pago fue creado, pero no pudo registrarse. No envíes fondos y contacta a soporte." });
    return res.status(201).json({ payment:data });
  });

  app.post("/api/influencers/evidence-url", async (req, res) => {
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { fileName, mimeType, size } = req.body || {};
    if (typeof fileName !== "string" || fileName.length > 180 || !MIME_TYPES.has(mimeType) || !Number.isFinite(size) || size < 1 || size > MAX_FILE_SIZE) return res.status(400).json({ error: "Adjunta una imagen o PDF de hasta 10 MB." });
    const { data: packageRow } = await auth.client.from("influencer_packages").select("id,status").eq("user_id", auth.userId).eq("status", "active").maybeSingle();
    if (!packageRow) return res.status(409).json({ error: "Necesitas un paquete Influencers activo." });
    const path = `${auth.userId}/${packageRow.id}/${crypto.randomUUID()}.${safeExtension(fileName)}`;
    const { data, error } = await auth.client.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return res.status(503).json({ error: "No se pudo preparar la carga de evidencia." });
    return res.json({ path, token: data.token });
  });

  app.post("/api/influencers/submissions", async (req, res) => {
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { platform, storyUrl, evidencePath, campaignCode, publishedAt, reportedViews } = req.body || {};
    if (!["instagram", "facebook"].includes(platform) || typeof storyUrl !== "string" || storyUrl.length < 10 || storyUrl.length > 500 || !validStoryUrl(platform, storyUrl) || typeof evidencePath !== "string" || !evidencePath.startsWith(`${auth.userId}/`) || typeof campaignCode !== "string" || campaignCode.length < 3 || campaignCode.length > 60 || !Number.isInteger(reportedViews) || reportedViews < 0 || reportedViews > 10000000) return res.status(400).json({ error: "Revisa la red, enlace, código, evidencia y vistas reportadas." });
    const published = new Date(publishedAt);
    if (Number.isNaN(published.getTime()) || published.getTime() > Date.now() + 5 * 60_000 || published.getTime() < Date.now() - 30 * 60 * 60_000) return res.status(400).json({ error: "La historia debe haberse publicado durante las últimas 24 horas." });
    const { data: packageRow } = await auth.client.from("influencer_packages").select("id,status,starts_at,ends_at").eq("user_id", auth.userId).eq("status", "active").maybeSingle();
    if (!packageRow || (packageRow.ends_at && new Date(packageRow.ends_at) <= new Date())) return res.status(409).json({ error: "No tienes un paquete Influencers activo." });
    const { error: evidenceError } = await auth.client.storage.from(BUCKET).createSignedUrl(evidencePath, 60);
    if (evidenceError) return res.status(409).json({ error: "La evidencia no existe o no terminó de cargarse." });
    const { data, error } = await auth.client.rpc("create_influencer_submission", { p_user_id: auth.userId, p_platform: platform, p_story_url: storyUrl.trim(), p_evidence_path: evidencePath, p_campaign_code: campaignCode.trim().toUpperCase(), p_published_at: published.toISOString(), p_reported_views: reportedViews });
    if (error) return res.status(error.code === "23505" ? 409 : 503).json({ error: error.code === "23505" ? "Esta evidencia ya fue registrada." : error.message || "No se pudo registrar la evidencia." });
    return res.status(201).json({ submission: data });
  });

  app.get("/api/admin/influencers", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const admin = await authenticatedAdmin(req);
    if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
    const { data: packages, error } = await admin.client.from("influencer_packages").select("*").order("created_at", { ascending: false }).limit(250);
    if (error) return res.status(503).json({ error: "Falta aplicar la migración del programa Influencers." });
    const { data: submissions } = await admin.client.from("influencer_submissions").select("*").order("submitted_at", { ascending: false }).limit(250);
    const { data: payouts } = await admin.client.from("influencer_weekly_payouts").select("*").order("week_start", { ascending: false }).limit(250);
    const userIds = Array.from(new Set([...(packages || []).map(row => row.user_id), ...(submissions || []).map(row => row.user_id)]));
    const { data: profiles } = userIds.length ? await admin.client.from("profiles").select("id,username").in("id", userIds) : { data: [] };
    const profileMap = new Map((profiles || []).map(row => [row.id, row]));
    const enriched = await Promise.all((submissions || []).map(async row => {
      const { data } = await admin.client.storage.from(BUCKET).createSignedUrl(row.evidence_path, 900);
      return { ...row, profiles: profileMap.get(row.user_id) || null, evidence_url: data?.signedUrl || null };
    }));
    return res.json({ packages: (packages || []).map(row => ({ ...row, profiles: profileMap.get(row.user_id) || null })), submissions: enriched, payouts: (payouts || []).map(row => ({ ...row, profiles: profileMap.get(row.user_id) || null })) });
  });

  app.post("/api/admin/influencers/activate", async (req, res) => {
    const admin = await authenticatedAdmin(req);
    if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
    const { packageId, paymentMethod, paymentReference } = req.body || {};
    if (typeof packageId !== "string" || !["manual", "crypto"].includes(paymentMethod) || typeof paymentReference !== "string" || paymentReference.trim().length < 6) return res.status(400).json({ error: "Paquete, método y referencia de pago son obligatorios." });
    const { data, error } = await admin.client.rpc("admin_activate_influencer_package", { p_admin_id: admin.userId, p_package_id: packageId, p_payment_method: paymentMethod, p_payment_reference: paymentReference.trim() });
    if (error) return res.status(409).json({ error: "El paquete ya no está pendiente o no pudo activarse." });
    await recordAdminOperation(admin.client, { adminId: admin.userId, action: "activate_influencer_package", targetType: "influencer_package", targetId: packageId, details: { userId: data.user_id, durationDays: data.duration_days, paymentMethod, paymentReference: paymentReference.trim() } });
    return res.json({ package: data });
  });

  app.post("/api/admin/influencers/maintenance", async (req, res) => {
    const admin = await authenticatedAdmin(req);
    if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
    const { data, error } = await admin.client.rpc("settle_due_influencer_payouts");
    if (error) return res.status(409).json({ error: error.message || "No se pudo cerrar la nómina semanal." });
    await recordAdminOperation(admin.client, { adminId: admin.userId, action: "settle_influencer_payouts", targetType: "influencer_weekly_payout", targetId: null, details: data || {} });
    return res.json({ result: data });
  });

  app.post("/api/admin/influencers/package-status", async (req, res) => {
    const admin = await authenticatedAdmin(req);
    if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
    const { packageId, status, reason } = req.body || {};
    if (typeof packageId !== "string" || !["active", "paused", "cancelled"].includes(status) || (status === "cancelled" && (typeof reason !== "string" || reason.trim().length < 5))) return res.status(400).json({ error: "Cambio de estado inválido." });
    const allowedFrom = status === "paused" ? ["active"] : status === "active" ? ["paused"] : ["pending", "active", "paused"];
    const { data, error } = await admin.client.from("influencer_packages").update({ status, cancel_reason: status === "cancelled" ? reason.trim() : null, updated_at: new Date().toISOString() }).eq("id", packageId).in("status", allowedFrom).select("id,user_id,status").single();
    if (error) return res.status(409).json({ error: "El paquete cambió de estado o no admite esa operación." });
    await recordAdminOperation(admin.client, { adminId: admin.userId, action: `influencer_package_${status}`, targetType: "influencer_package", targetId: packageId, details: { userId: data.user_id, reason: status === "cancelled" ? reason.trim() : null } });
    return res.json({ package: data });
  });

  app.post("/api/admin/influencers/review", async (req, res) => {
    const admin = await authenticatedAdmin(req);
    if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
    const { submissionId, decision, verifiedViews, note } = req.body || {};
    if (typeof submissionId !== "string" || !["approved", "rejected"].includes(decision) || !Number.isInteger(verifiedViews) || verifiedViews < 0 || verifiedViews > 10000000 || typeof note !== "string" || note.trim().length < 3 || note.length > 1000) return res.status(400).json({ error: "Completa decisión, vistas verificadas y nota." });
    const { data, error } = await admin.client.rpc("admin_review_influencer_submission", { p_admin_id: admin.userId, p_submission_id: submissionId, p_decision: decision, p_verified_views: verifiedViews, p_note: note.trim() });
    if (error) return res.status(409).json({ error: error.message || "La evidencia cambió mientras la revisabas. Actualiza el listado." });
    await recordAdminOperation(admin.client, { adminId: admin.userId, action: `influencer_submission_${decision}`, targetType: "influencer_submission", targetId: submissionId, details: { verifiedViews, rewardAmount: Number(data?.reward_amount || 0), note: note.trim() } });
    return res.json({ submission: data });
  });
}
