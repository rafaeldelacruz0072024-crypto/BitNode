type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type AuthUser = {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
};

type Profile = {
  id: string;
  username?: string | null;
  display_name?: string | null;
  sponsor_id?: string | null;
  role?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Transaction = {
  id: string;
  user_id?: string | null;
  username?: string | null;
  type?: string | null;
  label?: string | null;
  amount?: number | string | null;
  status?: string | null;
  network?: string | null;
  wallet?: string | null;
  fee?: number | string | null;
  net_amount?: number | string | null;
  created_at?: string | null;
  provider_status?: string | null;
};

type Commission = {
  id?: string;
  beneficiary_id?: string;
  source_user_id?: string;
  source_event_id?: string;
  commission_type?: string | null;
  amount?: number | string | null;
  rate?: number | string | null;
  leg?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type Volume = {
  user_id: string;
  leg?: string | null;
  volume?: number | string | null;
  matched_volume?: number | string | null;
  updated_at?: string | null;
};

type Dataset<T> = { rows: T[]; count: number };

const MAX_ROWS = 500;
const BINARY_COMMISSION_RATE = 0.1;

const firstHeader = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const numberValue = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const maskWallet = (wallet?: string | null) => {
  if (!wallet) return null;
  const normalized = wallet.trim();
  if (normalized.length <= 10) return `${normalized.slice(0, 3)}•••`;
  return `${normalized.slice(0, 6)}…${normalized.slice(-6)}`;
};

function respond(res: VercelResponse, status: number, body: Record<string, unknown>) {
  res.status(status).json(body);
}

function credentials() {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl || !serviceKey) throw new Error("Las credenciales administrativas del servidor no están configuradas.");
  return { baseUrl, serviceKey };
}

async function fetchDataset<T>(url: string, headers: Record<string, string>): Promise<Dataset<T>> {
  const response = await fetch(url, { headers: { ...headers, Prefer: "count=exact" } });
  if (!response.ok) throw new Error(`La consulta de datos falló con ${response.status}.`);
  const rows = await response.json() as T[];
  const contentRange = response.headers.get("content-range") || "";
  const countMatch = contentRange.match(/\/([0-9]+)$/);
  return { rows: Array.isArray(rows) ? rows : [], count: countMatch ? Number(countMatch[1]) : rows.length };
}

async function authenticateAdmin(accessToken: string) {
  const { baseUrl, serviceKey } = credentials();
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const authResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
  if (!authResponse.ok) return null;
  const user = await authResponse.json() as { id?: string; email?: string | null };
  if (!user.id) return null;
  const profileResponse = await fetch(`${baseUrl}/rest/v1/profiles?select=id,username,role&id=eq.${encodeURIComponent(user.id)}&limit=1`, { headers: serviceHeaders });
  if (!profileResponse.ok) throw new Error(`Profile lookup failed with ${profileResponse.status}.`);
  const profiles = await profileResponse.json() as Array<{ id: string; username?: string | null; role?: string | null }>;
  if (profiles[0]?.role !== "admin") return { forbidden: true } as const;
  return { user, profile: profiles[0], baseUrl, serviceHeaders } as const;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return respond(res, 405, { error: "Método no permitido." });
  }

  const authorization = firstHeader(req.headers.authorization);
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) return respond(res, 401, { error: "Sesión requerida.", status: "unauthenticated" });

  try {
    const admin = await authenticateAdmin(accessToken);
    if (!admin) return respond(res, 401, { error: "La sesión no es válida o expiró.", status: "unauthenticated" });
    if ("forbidden" in admin) return respond(res, 403, { error: "El usuario no tiene rol administrativo.", status: "forbidden" });

    const { baseUrl, serviceHeaders, user, profile } = admin;
    const [profiles, transactions, commissions, volumes, authResponse] = await Promise.all([
      fetchDataset<Profile>(`${baseUrl}/rest/v1/profiles?select=id,username,display_name,sponsor_id,role,created_at,updated_at&order=created_at.desc&limit=${MAX_ROWS}`, serviceHeaders),
      fetchDataset<Transaction>(`${baseUrl}/rest/v1/transactions?select=id,user_id,username,type,label,amount,status,network,wallet,fee,net_amount,created_at,provider_status&order=created_at.desc&limit=${MAX_ROWS}`, serviceHeaders),
      fetchDataset<Commission>(`${baseUrl}/rest/v1/commission_ledger?select=id,beneficiary_id,source_user_id,source_event_id,commission_type,amount,rate,leg,status,created_at&order=created_at.desc&limit=${MAX_ROWS}`, serviceHeaders),
      fetchDataset<Volume>(`${baseUrl}/rest/v1/network_volume?select=user_id,leg,volume,matched_volume,updated_at&order=updated_at.desc&limit=${MAX_ROWS}`, serviceHeaders),
      fetch(`${baseUrl}/auth/v1/admin/users?per_page=${MAX_ROWS}&page=1`, { headers: serviceHeaders }),
    ]);

    const authUsers = authResponse.ok ? ((await authResponse.json() as { users?: AuthUser[] }).users ?? []) : [];
    const authById = new Map(authUsers.map((authUser) => [authUser.id, authUser]));
    const profileById = new Map(profiles.rows.map((row) => [row.id, row]));
    const credited = commissions.rows.filter((row) => row.status === "credited");
    const pending = commissions.rows.filter((row) => row.status === "pending");
    const direct = credited.filter((row) => row.commission_type === "direct").reduce((sum, row) => sum + numberValue(row.amount), 0);
    const binary = credited.filter((row) => row.commission_type === "binary").reduce((sum, row) => sum + numberValue(row.amount), 0);
    const pendingCommissions = pending.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const contracts = transactions.rows.filter((row) => row.type === "contract");
    const contractVolume = contracts.filter((row) => row.status !== "failed").reduce((sum, row) => sum + numberValue(row.amount), 0);
    const pendingTransactions = transactions.rows.filter((row) => row.status === "pending");
    const left = volumes.rows.filter((row) => row.leg === "left").reduce((sum, row) => sum + numberValue(row.volume), 0);
    const right = volumes.rows.filter((row) => row.leg === "right").reduce((sum, row) => sum + numberValue(row.volume), 0);
    const matched = Math.min(left, right);

    const users = profiles.rows.map((row) => {
      const authUser = authById.get(row.id);
      return {
        id: row.id,
        username: row.username ?? null,
        displayName: row.display_name ?? null,
        email: authUser?.email ?? null,
        role: row.role ?? "user",
        sponsorId: row.sponsor_id ?? null,
        createdAt: row.created_at ?? authUser?.created_at ?? null,
        lastSignInAt: authUser?.last_sign_in_at ?? null,
        emailConfirmedAt: authUser?.email_confirmed_at ?? null,
        bannedUntil: authUser?.banned_until ?? null,
        status: authUser?.banned_until && new Date(authUser.banned_until).getTime() > Date.now() ? "suspendido" : authUser?.email_confirmed_at ? "activo" : "pendiente",
      };
    });

    const normalizedTransactions = transactions.rows.map((row) => ({
      id: row.id,
      userId: row.user_id ?? null,
      username: row.username ?? (row.user_id ? profileById.get(row.user_id)?.username ?? null : null),
      type: row.type ?? "unknown",
      label: row.label ?? null,
      amount: round(numberValue(row.amount)),
      status: row.status ?? "unknown",
      network: row.network ?? null,
      wallet: maskWallet(row.wallet),
      fee: round(numberValue(row.fee)),
      netAmount: round(numberValue(row.net_amount)),
      providerStatus: row.provider_status ?? null,
      cycle: row.type === "contract" ? row.label ?? null : null,
      startAt: row.type === "contract" ? row.created_at ?? null : null,
      endAt: null,
      createdAt: row.created_at ?? null,
    }));

    const normalizedCommissions = commissions.rows.map((row) => ({
      id: row.id ?? null,
      beneficiaryId: row.beneficiary_id ?? null,
      sourceUserId: row.source_user_id ?? null,
      sourceEventId: row.source_event_id ?? null,
      type: row.commission_type ?? "unknown",
      amount: round(numberValue(row.amount)),
      rate: numberValue(row.rate),
      leg: row.leg ?? null,
      status: row.status ?? "unknown",
      createdAt: row.created_at ?? null,
    }));

    return respond(res, 200, {
      status: "ready",
      readOnly: false,
      user: { id: user.id, email: user.email ?? null, username: profile.username ?? null, role: profile.role },
      lastUpdated: new Date().toISOString(),
      metrics: {
        users: profiles.count,
        contracts: contracts.length,
        contractVolume: round(contractVolume),
        transactions: transactions.count,
        pendingTransactions: pendingTransactions.length,
        pendingCommissions: round(pendingCommissions),
        creditedCommissions: round(direct + binary),
        networkVolumes: volumes.count,
      },
      users,
      contracts: normalizedTransactions.filter((row) => row.type === "contract"),
      transactions: normalizedTransactions,
      commissions: {
        configuredDirectRate: 0.1,
        configuredBinaryRate: BINARY_COMMISSION_RATE,
        direct: round(direct),
        binary: round(binary),
        total: round(direct + binary),
        pending: round(pendingCommissions),
        entries: normalizedCommissions,
      },
      binaryVolume: {
        left: round(left),
        right: round(right),
        matched: round(matched),
        status: matched > 0 ? "paired" : left > 0 || right > 0 ? "awaiting_pair" : "no_volume",
      },
    });
  } catch (error) {
    console.error("[admin-data]", error);
    return respond(res, 503, { error: "No se pudieron cargar los datos administrativos.", status: "unavailable" });
  }
}
