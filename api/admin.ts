type VercelRequest = { method?: string; headers: Record<string, string | string[] | undefined> };
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
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Método no permitido" }); }

  const authorization = headerValue(req.headers.authorization);
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) return res.status(401).json({ error: "Sesión Supabase requerida.", status: "unauthenticated" });

  try {
    const user = await supabaseUser(accessToken);
    if (!user) return res.status(401).json({ error: "La sesión Supabase no es válida o expiró.", status: "unauthenticated" });
    const profile = await userProfile(user.id);
    if (!profile || profile.role !== "admin") return res.status(403).json({ error: "El usuario no tiene rol administrativo.", status: "forbidden" });
    return res.status(200).json({ status: "ready", readOnly: true, user: { id: user.id, email: user.email, username: profile.username, role: profile.role }, scope: ["overview"] });
  } catch (error) {
    console.error("[admin-auth]", error);
    return res.status(503).json({ error: "La validación administrativa no está disponible.", status: "unavailable" });
  }
}
