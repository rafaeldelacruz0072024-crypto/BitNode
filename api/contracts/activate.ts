type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const headerValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

function credentials() {
  const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured.");
  return { baseUrl, serviceKey };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const accessToken = (headerValue(req.headers.authorization) || "").replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return res.status(401).json({ error: "Sesión Supabase requerida." });

  const body = (req.body || {}) as Record<string, unknown>;
  const contractId = typeof body.contractId === "string" ? body.contractId.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!contractId || !Number.isFinite(amount) || amount < 10 || amount > 100000) {
    return res.status(400).json({ error: "contractId y un monto entre 10 y 100000 son requeridos." });
  }

  try {
    const { baseUrl, serviceKey } = credentials();
    const authHeaders = { apikey: serviceKey, Authorization: `Bearer ${accessToken}` };
    const authResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers: authHeaders });
    if (!authResponse.ok) return res.status(401).json({ error: "La sesión Supabase no es válida o expiró." });
    const user = await authResponse.json() as { id?: string };
    if (!user.id) return res.status(401).json({ error: "Usuario Supabase inválido." });

    const rpcResponse = await fetch(`${baseUrl}/rest/v1/rpc/activate_contract_and_commissions`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: user.id, p_contract_id: contractId, p_username: username, p_label: label, p_amount: amount }),
    });
    const result = await rpcResponse.json().catch(() => ({}));
    if (!rpcResponse.ok) return res.status(rpcResponse.status >= 400 && rpcResponse.status < 500 ? 400 : 503).json({ error: "No se pudo activar el contrato.", details: result });
    return res.status(200).json(result);
  } catch (error) {
    console.error("[contract-activation]", error);
    return res.status(503).json({ error: "La activación no está disponible." });
  }
}
