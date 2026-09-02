import { createClient } from "@supabase/supabase-js";

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const firstHeader = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
const text = (value: unknown, max = 120) => String(value || "").trim().slice(0, max);
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function serverClient() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Las credenciales administrativas no están configuradas.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const authorization = firstHeader(req.headers.authorization);
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Sesión requerida." });

  try {
    const client = serverClient();
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return res.status(401).json({ error: "La sesión no es válida." });

    const { data: operator, error: operatorError } = await client
      .from("profiles")
      .select("id,role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (operatorError || operator?.role !== "admin" || authData.user.email?.toLowerCase() !== "gentecash@gmail.com") {
      return res.status(403).json({ error: "No tienes permisos para editar usuarios." });
    }

    const userId = text(req.body?.userId, 36);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: "Usuario inválido." });

    const username = text(req.body?.username, 48);
    const displayName = text(req.body?.displayName, 120);
    const email = text(req.body?.email, 254).toLowerCase();
    if (!username || !/^[a-zA-Z0-9_-]{3,48}$/.test(username)) {
      return res.status(400).json({ error: "El usuario debe tener entre 3 y 48 caracteres alfanuméricos." });
    }
    if (!email || !isEmail(email)) return res.status(400).json({ error: "Correo electrónico inválido." });

    const { data: target, error: targetError } = await client.auth.admin.getUserById(userId);
    if (targetError || !target.user) return res.status(404).json({ error: "Usuario no encontrado." });

    const details = {
      full_name: text(req.body?.fullName, 120),
      phone: text(req.body?.phone, 40),
      country: text(req.body?.country, 80),
      city: text(req.body?.city, 80),
      wallet_bep20: text(req.body?.walletBep20, 128),
      wallet_trc20: text(req.body?.walletTrc20, 128),
    };
    const metadata = { ...(target.user.user_metadata || {}), ...details };
    const { error: authUpdateError } = await client.auth.admin.updateUserById(userId, {
      email,
      user_metadata: metadata,
    });
    if (authUpdateError) return res.status(400).json({ error: authUpdateError.message });

    const { error: profileError } = await client
      .from("profiles")
      .update({ username, display_name: displayName || null, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (profileError) return res.status(400).json({ error: profileError.message });

    return res.status(200).json({
      status: "updated",
      user: { id: userId, email, username, displayName, details },
    });
  } catch (error) {
    console.error("[admin-user-manager]", error);
    return res.status(503).json({ error: "No se pudo actualizar el usuario." });
  }
}
