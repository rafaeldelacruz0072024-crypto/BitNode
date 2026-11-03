import type { Express } from "express";
import { createClient } from "@supabase/supabase-js";
import { NODES_V2 } from "../shared/nodesV2.js";

export function registerNodesV2Routes(app: Express) {
  app.get("/api/nodes/v2", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const accessToken = (req.header("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return res.status(401).json({ error: "Sesión requerida." });
    try {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("Server not configured");
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const auth = await client.auth.getUser(accessToken);
      if (auth.error || !auth.data.user) return res.status(401).json({ error: "Sesión inválida." });
      const [profile, plans, release] = await Promise.all([
        client.from("profiles").select("role").eq("id", auth.data.user.id).single(),
        client.from("plans").select("id,active,rate_min,rate_max,duration_days,min_amount").in("id", NODES_V2.map(p => p.id)),
        client.from("platform_settings").select("value").eq("key", "nodes_v2_release").maybeSingle(),
      ]);
      if (profile.error || plans.error || release.error) throw new Error("Catalog unavailable");
      const enabled = release.data?.value?.enabled === true;
      const isAdmin = profile.data?.role === "admin";
      if (!enabled && !isAdmin) return res.status(404).json({ error: "Los Nodos 2.0 aún no están disponibles." });
      return res.json({ preview: !enabled, plans: NODES_V2.map(plan => {
        const stored = plans.data?.find(p => p.id === plan.id);
        const matches = stored && Number(stored.rate_min) === plan.rateMin && Number(stored.rate_max) === plan.rateMax
          && Number(stored.duration_days) === plan.days && Number(stored.min_amount) === plan.min;
        return { ...plan, enabled: Boolean(enabled && matches && stored.active) };
      }) });
    } catch {
      return res.status(503).json({ error: "No se pudo verificar el catálogo de Nodos 2.0." });
    }
  });
}
