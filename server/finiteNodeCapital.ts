import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

export function registerFiniteNodeCapitalRoutes(app: Express) {
  app.post("/api/nodes/capital-choice", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "El servicio no está configurado." });
    const bearer = req.header("authorization") || "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "Sesión requerida." });
    const contractId = String(req.body?.contractId || "").trim();
    const action = String(req.body?.action || "");
    if (!contractId || contractId.length > 120 || !["claim", "reinvest"].includes(action))
      return res.status(400).json({ error: "Elección de capital inválida." });
    try {
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: auth, error: authError } = await client.auth.getUser(token);
      if (authError || !auth.user) return res.status(401).json({ error: "Sesión inválida." });
      const { data, error } = await client.rpc("choose_finite_node_capital", {
        p_user_id: auth.user.id, p_contract_id: contractId, p_action: action,
      });
      if (error) return res.status(error.code === "P0001" || error.code === "23505" ? 409 : 503)
        .json({ error: error.code === "P0001" ? error.message : "No se pudo procesar la elección del capital." });
      return res.status(200).json(data);
    } catch (error) {
      console.error("[finite-node-capital]", error);
      return res.status(503).json({ error: "No se pudo procesar la elección del capital." });
    }
  });
}
