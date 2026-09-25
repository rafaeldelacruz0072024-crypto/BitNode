import { recordAdminOperation } from "../server/adminAudit.js";

type VercelRequest = { method?: string; headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };
type VercelResponse = { status: (code: number) => VercelResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };

type SupabaseUser = { id: string; email?: string };
type Profile = { id: string; username?: string | null; role?: string | null };

const headerValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

async function supabaseUser(accessToken: string): Promise<SupabaseUser | null> {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Las credenciales del servidor no están configuradas.");
  const response = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  return await response.json() as SupabaseUser;
}

async function userProfile(userId: string): Promise<Profile | null> {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Las credenciales administrativas del servidor no están configuradas.");
  const response = await fetch(`${baseUrl}/rest/v1/profiles?select=id,username,role&id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!response.ok) throw new Error(`Profile lookup failed with ${response.status}.`);
  const profiles = await response.json() as Profile[];
  return profiles[0] ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" && req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Método no permitido" }); }

  const authorization = headerValue(req.headers.authorization);
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) return res.status(401).json({ error: "Sesión requerida.", status: "unauthenticated" });

  try {
    const user = await supabaseUser(accessToken);
    if (!user) return res.status(401).json({ error: "La sesión no es válida o expiró.", status: "unauthenticated" });
    const profile = await userProfile(user.id);
    if (!profile || profile.role !== "admin") return res.status(403).json({ error: "El usuario no tiene rol administrativo.", status: "forbidden" });
    if (req.method === "GET") return res.status(200).json({ status: "ready", readOnly: false, user: { id: user.id, email: user.email, username: profile.username, role: profile.role }, scope: ["overview", "balance_adjustment"] });

    const targetUserId = String(req.body?.userId || "").trim();
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || "Depósito administrativo").trim().slice(0, 160);
    const requestId = String(req.body?.requestId || "").trim();
    const corporate = req.body?.corporate === true;
    const operation = req.body?.operation === "remove" ? "remove" : "add";
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return res.status(400).json({ error: "Usuario destino inválido." });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return res.status(400).json({ error: "El monto debe estar entre 0.01 y 1,000,000 USDT." });
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return res.status(400).json({ error: "Identificador de operación inválido." });

    const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (corporate && operation === "remove") return res.status(400).json({ error: "La activación corporativa solo puede agregar balance." });
    const rpc = operation === "remove" ? "admin_adjust_balance" : "admin_credit_deposit";
    const signedAmount = operation === "remove" ? -amount : amount;
    const rpcBody = operation !== "remove"
      ? { p_user_id: targetUserId, p_amount: amount, p_reason: reason, p_request_id: requestId, p_admin_id: user.id, p_corporate: corporate }
      : { p_user_id: targetUserId, p_amount: signedAmount, p_reason: reason, p_request_id: requestId, p_admin_id: user.id };
    const depositResponse = await fetch(`${baseUrl}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
    });
    if (!depositResponse.ok) {
      const detail = await depositResponse.json().catch(() => ({})) as { message?: string };
      console.error("[admin-balance-adjustment]", depositResponse.status, detail.message);
      return res.status(depositResponse.status === 400 ? 400 : 500).json({ error: detail.message || "No se pudo registrar el ajuste de balance." });
    }
    const result = await depositResponse.json() as { id: string; status: string; corporate?: boolean; balance?: number; amount?: number };
    if (result.status !== "duplicate") await recordAdminOperation({ from: (table: string) => ({
      insert: async (value: Record<string, unknown>) => {
        const response = await fetch(`${baseUrl}/rest/v1/${table}`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(value) });
        return { error: response.ok ? null : { message: `Audit insert failed with ${response.status}` } };
      },
      upsert: async (value: Record<string, unknown>) => {
        const response = await fetch(`${baseUrl}/rest/v1/${table}`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(value) });
        return { error: response.ok ? null : { message: `Audit fallback failed with ${response.status}` } };
      },
    }) }, { adminId: user.id, adminEmail: user.email || null, adminUsername: profile.username || null, action: operation === "remove" ? "balance_debited" : corporate ? "corporate_account_activated" : "balance_credited", targetType: "profile", targetId: targetUserId, details: { amount: signedAmount, reason, transactionId: result.id } });
    return res.status(result.status === "duplicate" ? 200 : 201).json({ ...result, userId: targetUserId, operation });
  } catch (error) {
    console.error("[admin-auth]", error);
    return res.status(503).json({ error: "La validación administrativa no está disponible.", status: "unavailable" });
  }
}
