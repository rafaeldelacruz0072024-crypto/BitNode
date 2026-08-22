type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido" });
  }

  const configuredKey = process.env.ADMIN_API_KEY;
  const authorization = req.headers.authorization;
  const providedKey = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;

  if (!configuredKey || !providedKey || providedKey !== configuredKey) {
    return res.status(configuredKey ? 401 : 503).json({
      error: configuredKey ? "Credencial administrativa requerida." : "ADMIN_API_KEY no configurada.",
      status: "locked",
    });
  }

  return res.status(200).json({
    status: "ready",
    message: "Función nativa de Vercel operativa.",
    readOnly: true,
    scope: ["overview"],
  });
}
