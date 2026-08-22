import type { VercelRequest, VercelResponse } from "@vercel/node";
import { BINARY_COMMISSION_RATE, binaryPairingStatus } from "../../server/binaryCommission";

function respond(res: VercelResponse, status: number, body: Record<string, unknown>) {
  res.status(status).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return respond(res, 405, { error: "Método no permitido." });
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl || !serviceKey) return respond(res, 503, { error: "Supabase server-side no está configurado." });
  if (!token) return respond(res, 401, { error: "Sesión Supabase requerida." });

  const authResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } });
  if (!authResponse.ok) return respond(res, 401, { error: "Token Supabase inválido o expirado." });
  const user = await authResponse.json() as { id?: string; email?: string };
  if (!user.id) return respond(res, 401, { error: "Usuario Supabase inválido." });

  const profileResponse = await fetch(`${baseUrl}/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(user.id)}&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!profileResponse.ok) return respond(res, 503, { error: "No se pudo consultar el rol administrativo." });
  const profiles = await profileResponse.json() as Array<{ role?: string }>;
  if (profiles[0]?.role !== "admin") return respond(res, 403, { error: "Se requiere rol admin." });

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const [ledgerResponse, volumeResponse] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/commission_ledger?select=amount,commission_type,status,created_at&beneficiary_id=eq.${encodeURIComponent(user.id)}&status=eq.credited&order=created_at.desc&limit=100`, { headers }),
    fetch(`${baseUrl}/rest/v1/network_volume?select=leg,volume,matched_volume,updated_at&user_id=eq.${encodeURIComponent(user.id)}`, { headers }),
  ]);
  if (!ledgerResponse.ok || !volumeResponse.ok) return respond(res, 503, { error: "No se pudo consultar el resumen de comisiones." });
  const ledger = await ledgerResponse.json() as Array<{ amount?: number | string; commission_type?: string; status?: string; created_at?: string }>;
  const volume = await volumeResponse.json() as Array<{ leg?: string; volume?: number | string; matched_volume?: number | string; updated_at?: string }>;
  const direct = ledger.filter((row) => row.commission_type === "direct").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const binary = ledger.filter((row) => row.commission_type === "binary").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const left = Number(volume.find((row) => row.leg === "left")?.volume || 0);
  const right = Number(volume.find((row) => row.leg === "right")?.volume || 0);
  const matched = Math.min(left, right);
  return respond(res, 200, {
    user: { id: user.id, email: user.email || null, role: "admin" },
    configuredRate: BINARY_COMMISSION_RATE,
    direct,
    binary,
    total: direct + binary,
    binaryVolume: { left, right, matched, status: binaryPairingStatus(left, right) },
    entries: ledger,
  });
}
