type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const headerValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const accessToken = (headerValue(req.headers.authorization) || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!accessToken)
    return res.status(401).json({ error: "Sesión Supabase requerida." });

  try {
    const baseUrl = (
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ""
    ).replace(/\/$/, "");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!baseUrl || !serviceKey)
      throw new Error("Supabase server credentials are not configured.");

    const authResponse = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!authResponse.ok)
      return res
        .status(401)
        .json({ error: "La sesión Supabase no es válida o expiró." });
    const user = (await authResponse.json()) as { id?: string };
    if (!user.id)
      return res.status(401).json({ error: "Usuario Supabase inválido." });

    const ownedUserFilter = encodeURIComponent(user.id);
    const query = `select=id,type,label,amount,status,network,wallet,fee,net_amount,created_at&user_id=eq.${ownedUserFilter}&order=created_at.desc&limit=200`;
    const contractsQuery = `select=id,plan_id,amount,status,starts_at,ends_at,created_at,plans(name,rate_min,rate_max,duration_days)&user_id=eq.${ownedUserFilter}&order=created_at.desc&limit=200`;
    const ledgerResponse = await fetch(
      `${baseUrl}/rest/v1/transactions?${query}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }
    );
    const contractsResponse = await fetch(
      `${baseUrl}/rest/v1/contracts?${contractsQuery}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }
    );
    if (!ledgerResponse.ok)
      throw new Error(`Ledger lookup failed with ${ledgerResponse.status}.`);
    if (!contractsResponse.ok)
      throw new Error(
        `Contract lookup failed with ${contractsResponse.status}.`
      );
    const transactions = (await ledgerResponse.json()) as Array<
      Record<string, unknown>
    >;
    const contracts = (await contractsResponse.json()) as Array<
      Record<string, unknown>
    >;
    return res.status(200).json({ transactions, contracts });
  } catch (error) {
    console.error("[account-summary]", error);
    return res
      .status(503)
      .json({ error: "No se pudo cargar el balance de la cuenta." });
  }
}
