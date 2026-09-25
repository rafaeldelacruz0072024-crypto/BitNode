import { createClient } from "@supabase/supabase-js";
import { recordAdminOperation } from "../../server/adminAudit.js";

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
  if (req.method !== "PATCH" && req.method !== "POST" && req.method !== "PUT") {
    res.setHeader("Allow", "PATCH, POST, PUT");
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
      .select("id,role,username")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (operatorError || operator?.role !== "admin" || authData.user.email?.toLowerCase() !== "gentecash@gmail.com") {
      return res.status(403).json({ error: "No tienes permisos para editar usuarios." });
    }

    const userId = text(req.body?.userId, 36);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: "Usuario inválido." });

    if (req.method === "PUT") {
      const blocked = req.body?.withdrawalBlocked === true;
      const reason = text(req.body?.reason || "Bloqueado por administración", 160);
      const { data: targetProfile, error: targetProfileError } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (targetProfileError || !targetProfile) return res.status(404).json({ error: "Usuario no encontrado." });
      if (targetProfile.role === "admin") return res.status(403).json({ error: "No se pueden bloquear los retiros de una cuenta administrativa." });
      if (blocked) {
        const { error } = await client.from("withdrawal_restrictions").upsert({
          user_id: userId, reason: reason || "Bloqueado por administración",
          blocked_by: authData.user.id, blocked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) return res.status(400).json({ error: error.message });
      } else {
        const { error } = await client.from("withdrawal_restrictions").delete().eq("user_id", userId);
        if (error) return res.status(400).json({ error: error.message });
      }
      await recordAdminOperation(client as never, { adminId: authData.user.id, adminEmail: authData.user.email || null, adminUsername: operator.username || null, action: blocked ? "user_withdrawals_blocked" : "user_withdrawals_unblocked", targetType: "profile", targetId: userId, details: { reason: blocked ? reason : null } });
      return res.status(200).json({ status: blocked ? "withdrawals_blocked" : "withdrawals_unblocked", userId, withdrawalBlocked: blocked });
    }

    if (req.method === "POST") {
      const password = req.body?.password;
      if (typeof password !== "string" || password.length < 12 || password.length > 128 || !password.trim()) {
        return res.status(400).json({ error: "La contraseña debe tener entre 12 y 128 caracteres." });
      }
      const { data: target, error: targetError } = await client.auth.admin.getUserById(userId);
      if (targetError || !target.user) return res.status(404).json({ error: "Usuario no encontrado." });
      const { data: targetProfile, error: targetProfileError } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (targetProfileError) return res.status(503).json({ error: "No se pudo verificar el rol del usuario." });
      if (targetProfile?.role === "admin" || target.user.app_metadata?.role === "admin") {
        return res.status(403).json({ error: "Las contraseñas de administradores no se cambian desde este módulo." });
      }
      const { error: passwordError } = await client.auth.admin.updateUserById(userId, { password });
      if (passwordError) return res.status(400).json({ error: "No se pudo cambiar la contraseña. Verifica los requisitos de seguridad del proyecto." });
      await recordAdminOperation(client as never, { adminId: authData.user.id, adminEmail: authData.user.email || null, adminUsername: operator.username || null, action: "user_password_updated", targetType: "profile", targetId: userId });
      return res.status(200).json({ status: "password_updated", userId });
    }

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
      app_metadata: {
        ...(target.user.app_metadata || {}),
        withdrawal_wallet_bep20: details.wallet_bep20 || null,
      },
    });
    if (authUpdateError) return res.status(400).json({ error: authUpdateError.message });

    const { error: profileError } = await client
      .from("profiles")
      .update({ username, display_name: displayName || null, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (profileError) return res.status(400).json({ error: profileError.message });

    await recordAdminOperation(client as never, { adminId: authData.user.id, adminEmail: authData.user.email || null, adminUsername: operator.username || null, action: "user_profile_updated", targetType: "profile", targetId: userId, details: { username, displayName, email } });

    return res.status(200).json({
      status: "updated",
      user: { id: userId, email, username, displayName, details },
    });
  } catch (error) {
    console.error("[admin-user-manager]", error);
    return res.status(503).json({ error: "No se pudo actualizar el usuario." });
  }
}
