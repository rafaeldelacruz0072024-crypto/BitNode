type VercelRequest = { method?: string; headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };
type VercelResponse = { status: (code: number) => VercelResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };

type SupabaseUser = { id: string; email?: string };
type Profile = { id: string; username?: string | null; role?: string | null };

const headerValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

async function supabaseUser(accessToken: string): Promise<SupabaseUser | null> {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured.");
  const response = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  return await response.json() as SupabaseUser;
}

async function userProfile(userId: string): Promise<Profile | null> {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase service role credentials are not configured.");
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
  if (!accessToken) return res.status(401).json({ error: "Sesión Supabase requerida.", status: "unauthenticated" });

  try {
    const user = await supabaseUser(accessToken);
    if (!user) return res.status(401).json({ error: "La sesión Supabase no es válida o expiró.", status: "unauthenticated" });
    const profile = await userProfile(user.id);
    if (!profile || profile.role !== "admin") return res.status(403).json({ error: "El usuario no tiene rol administrativo.", status: "forbidden" });
    if ((user.email || "").toLowerCase() !== "gentecash@gmail.com") return res.status(403).json({ error: "Correo administrativo no autorizado.", status: "forbidden" });
    if (req.method === "GET") return res.status(200).json({ status: "ready", readOnly: false, user: { id: user.id, email: user.email, username: profile.username, role: profile.role }, scope: ["overview", "deposit"] });

    const targetUserId = String(req.body?.userId || "").trim();
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || "Depósito administrativo").trim().slice(0, 160);
    const requestId = String(req.body?.requestId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return res.status(400).json({ error: "Usuario destino inválido." });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return res.status(400).json({ error: "El monto debe estar entre 0.01 y 1,000,000 USDT." });
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return res.status(400).json({ error: "Identificador de operación inválido." });

    const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation,resolution=ignore-duplicates" };
    const targetResponse = await fetch(`${baseUrl}/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(targetUserId)}&limit=1`, { headers });
    const targets = targetResponse.ok ? await targetResponse.json() as Array<{ id: string; username: string }> : [];
    if (!targets[0]) return res.status(404).json({ error: "Usuario destino no encontrado." });
    const transactionId = `ADMIN-${requestId}`;
    const insertResponse = await fetch(`${baseUrl}/rest/v1/transactions`, { method: "POST", headers, body: JSON.stringify({ id: transactionId, user_id: targetUserId, username: targets[0].username, type: "deposit", label: reason || "Depósito administrativo", amount, status: "completed", provider_status: `admin_manual:${user.id}`, created_at: new Date().toISOString() }) });
    if (!insertResponse.ok) return res.status(500).json({ error: "No se pudo registrar el depósito administrativo." });
    return res.status(201).json({ status: "completed", id: transactionId, userId: targetUserId, amount });
  } catch (error) {
    console.error("[admin-auth]", error);
    return res.status(503).json({ error: "La validación administrativa no está disponible.", status: "unavailable" });
  }
}
