type VercelRequest = { method?: string; headers: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const headerValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });
  const token = (headerValue(req.headers.authorization) || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Sesión requerida." });

  try {
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!url || !key) throw new Error("Supabase no está configurado.");
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const auth = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (!auth.ok) return res.status(401).json({ error: "La sesión expiró." });
    const user = await auth.json() as { id?: string };
    if (!user.id) return res.status(401).json({ error: "Usuario inválido." });

    const response = await fetch(`${url}/rest/v1/rpc/get_withdrawal_availability`, {
      method: "POST", headers, body: JSON.stringify({ p_user_id: user.id }),
    });
    if (!response.ok) throw new Error("No se pudo consultar la disponibilidad.");
    const availability = await response.json() as Record<string, unknown>;
    const settingResponse = await fetch(`${url}/rest/v1/platform_settings?select=value&key=eq.withdrawal_window&limit=1`, { headers });
    if (!settingResponse.ok) throw new Error("No se pudo consultar la ventana global.");
    const settings = await settingResponse.json() as Array<{ value?: { enabled?: boolean } }>;
    const amounts = ["lockedDirect", "directUnspent", "directAvailable", "weeklyBonusUnspent",
      "finiteNodeRoiUnspent", "dailyNodeRoiCredited", "unrestricted", "withdrawableBalance"];
    const dates = ["nextDirectAvailableAt", "nextWeeklyWindowAt", "weeklyWindowClosesAt"];
    if (amounts.some(name => !Number.isFinite(Number(availability[name]))) ||
      dates.some(name => availability[name] !== null && availability[name] !== undefined &&
        (typeof availability[name] !== "string" || !Number.isFinite(Date.parse(availability[name] as string)))) ||
      typeof availability.weeklyWindowOpen !== "boolean") {
      throw new Error("Disponibilidad inválida.");
    }
    return res.status(200).json({
      lockedDirect: Math.max(0, Number(availability.lockedDirect)),
      directUnspent: Math.max(0, Number(availability.directUnspent)),
      directAvailable: Math.max(0, Number(availability.directAvailable)),
      weeklyBonusUnspent: Math.max(0, Number(availability.weeklyBonusUnspent)),
      finiteNodeRoiUnspent: Math.max(0, Number(availability.finiteNodeRoiUnspent)),
      dailyNodeRoiCredited: Math.max(0, Number(availability.dailyNodeRoiCredited)),
      unrestricted: Math.max(0, Number(availability.unrestricted)),
      withdrawableBalance: Math.max(0, Number(availability.withdrawableBalance)),
      nextDirectAvailableAt: availability.nextDirectAvailableAt || null,
      weeklyWindowOpen: availability.weeklyWindowOpen,
      nextWeeklyWindowAt: availability.nextWeeklyWindowAt || null,
      weeklyWindowClosesAt: availability.weeklyWindowClosesAt || null,
      globalWindowEnabled: settings[0]?.value?.enabled === true,
    });
  } catch (error) {
    console.error("[withdrawal-availability]", error);
    return res.status(503).json({ error: "No se pudo cargar el contador de la comisión directa." });
  }
}
