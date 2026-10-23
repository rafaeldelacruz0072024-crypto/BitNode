import type { Express, Request } from "express";
import { createClient } from "@supabase/supabase-js";
import { authenticatedAdmin } from "./adminWithdrawals.js";
import { recordAdminOperation } from "./adminAudit.js";

const BUCKET = "influencer-evidence";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

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

function mexicoWeekStart(value = new Date()) {
  const local = new Date(value.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const day = local.getDay() || 7;
  local.setDate(local.getDate() - day + 1);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

export function registerInfluencerRoutes(app: Express) {
  app.get("/api/influencers/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { data: packageRow, error } = await auth.client.from("influencer_packages").select("*").eq("user_id", auth.userId).in("status", ["pending", "active", "paused"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return res.status(503).json({ error: "El programa aún no está disponible en la base de datos." });
    const { data: submissions } = packageRow ? await auth.client.from("influencer_submissions").select("id,platform,story_url,campaign_code,story_published_at,submitted_at,status,reported_views,verified_views,reward_amount,review_note").eq("package_id", packageRow.id).order("submitted_at", { ascending: false }).limit(30) : { data: [] };
    const weekStart = mexicoWeekStart();
    const weekly = (submissions || []).filter(row => String(row.submitted_at) >= `${weekStart}T00:00:00`).reduce((sum, row) => sum + Number(row.reward_amount || 0), 0);
    return res.json({ package: packageRow || null, submissions: submissions || [], weekStart, weeklyReward: weekly });
  });

  app.post("/api/influencers/request", async (req, res) => {
    const auth = await authenticatedUser(req);
    if ("error" in auth) return res.status(auth.status || 401).json({ error: auth.error });
    const { data: existing } = await auth.client.from("influencer_packages").select("id,status").eq("user_id", auth.userId).in("status", ["pending", "active", "paused"]).maybeSingle();
    if (existing) return res.json({ package: existing });
    const { data, error } = await auth.client.from("influencer_packages").insert({ user_id: auth.userId }).select("id,status").single();
    if (error) return res.status(503).json({ error: error.code === "23505" ? "Ya tienes una solicitud abierta." : "No se pudo registrar la solicitud." });
    return res.status(201).json({ package: data });
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
    if (!["instagram", "facebook"].includes(platform) || typeof storyUrl !== "string" || storyUrl.length < 10 || storyUrl.length > 500 || typeof evidencePath !== "string" || !evidencePath.startsWith(`${auth.userId}/`) || typeof campaignCode !== "string" || campaignCode.length < 3 || campaignCode.length > 60 || !Number.isInteger(reportedViews) || reportedViews < 0 || reportedViews > 10000000) return res.status(400).json({ error: "Revisa la red, enlace, código, evidencia y vistas reportadas." });
    const published = new Date(publishedAt);
    if (Number.isNaN(published.getTime()) || published.getTime() > Date.now() + 5 * 60_000 || published.getTime() < Date.now() - 30 * 60 * 60_000) return res.status(400).json({ error: "La historia debe haberse publicado durante las últimas 24 horas." });
    const { data: packageRow } = await auth.client.from("influencer_packages").select("id,status,starts_at,ends_at").eq("user_id", auth.userId).eq("status", "active").maybeSingle();
    if (!packageRow || (packageRow.ends_at && new Date(packageRow.ends_at) <= new Date())) return res.status(409).json({ error: "No tienes un paquete Influencers activo." });
    const dayStart = new Date(Date.now() - 30 * 60 * 60_000).toISOString();
    const { count } = await auth.client.from("influencer_submissions").select("id", { count: "exact", head: true }).eq("package_id", packageRow.id).gte("story_published_at", dayStart);
    if ((count || 0) >= 3) return res.status(409).json({ error: "Alcanzaste el máximo de 3 historias dentro de 24 horas." });
    const { data, error } = await auth.client.from("influencer_submissions").insert({ package_id: packageRow.id, user_id: auth.userId, platform, story_url: storyUrl.trim(), evidence_path: evidencePath, campaign_code: campaignCode.trim().toUpperCase(), story_published_at: published.toISOString(), reported_views: reportedViews }).select("id,status").single();
    if (error) return res.status(error.code === "23505" ? 409 : 503).json({ error: error.code === "23505" ? "Esta evidencia ya fue registrada." : "No se pudo registrar la evidencia." });
    return res.status(201).json({ submission: data });
  });

  app.get("/api/admin/influencers", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const admin = await authenticatedAdmin(req);
    if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
    const { data: packages, error } = await admin.client.from("influencer_packages").select("*").order("created_at", { ascending: false }).limit(250);
    if (error) return res.status(503).json({ error: "Falta aplicar la migración del programa Influencers." });
    const { data: submissions } = await admin.client.from("influencer_submissions").select("*").order("submitted_at", { ascending: false }).limit(250);
    const userIds = Array.from(new Set([...(packages || []).map(row => row.user_id), ...(submissions || []).map(row => row.user_id)]));
    const { data: profiles } = userIds.length ? await admin.client.from("profiles").select("id,username").in("id", userIds) : { data: [] };
    const profileMap = new Map((profiles || []).map(row => [row.id, row]));
    const enriched = await Promise.all((submissions || []).map(async row => {
      const { data } = await admin.client.storage.from(BUCKET).createSignedUrl(row.evidence_path, 900);
      return { ...row, profiles: profileMap.get(row.user_id) || null, evidence_url: data?.signedUrl || null };
    }));
    return res.json({ packages: (packages || []).map(row => ({ ...row, profiles: profileMap.get(row.user_id) || null })), submissions: enriched });
  });

  app.post("/api/admin/influencers/activate", async (req, res) => {
    const admin = await authenticatedAdmin(req);
    if (admin.error) return res.status(admin.status || 403).json({ error: admin.error });
    const { packageId } = req.body || {};
    if (typeof packageId !== "string") return res.status(400).json({ error: "Paquete inválido." });
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 120 * 86400000);
    const { data, error } = await admin.client.from("influencer_packages").update({ status: "active", starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), activated_by: admin.userId, activated_at: startsAt.toISOString(), updated_at: startsAt.toISOString() }).eq("id", packageId).eq("status", "pending").select("id,user_id,status").single();
    if (error) return res.status(409).json({ error: "El paquete ya no está pendiente o no pudo activarse." });
    await recordAdminOperation(admin.client, { adminId: admin.userId, action: "activate_influencer_package", targetType: "influencer_package", targetId: packageId, details: { userId: data.user_id, durationDays: 120 } });
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
