import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

function admin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function token(req: Request) {
  const value = req.header("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export function validateManualDeposit(amount: number) {
  if (!Number.isFinite(amount) || amount < 10 || amount > 100000) return "El depósito debe estar entre $10 y $100,000 USDT.";
  return null;
}

export function registerDepositRoutes(app: Express) {
  app.post("/api/deposits/request", async (req: Request, res: Response) => {
    const client = admin();
    const accessToken = token(req);
    if (!client || !accessToken) return res.status(401).json({ error: "Sesión Supabase requerida." });

    const { data, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !data.user) return res.status(401).json({ error: "Sesión Supabase inválida." });

    const amount = Number(req.body?.amount);
    const validationError = validateManualDeposit(amount);
    if (validationError) return res.status(400).json({ error: validationError });

    const id = `DEP-${crypto.randomUUID()}`;
    const { error } = await client.from("transactions").insert({
      id,
      user_id: data.user.id,
      username: data.user.user_metadata?.username || data.user.email?.split("@")[0] || null,
      type: "deposit",
      label: "Depósito manual · pendiente",
      amount,
      status: "pending",
      provider_status: "manual_review",
      created_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: "No se pudo registrar el depósito pendiente." });
    return res.status(201).json({ id, status: "pending", credited: false, message: "Depósito registrado para confirmación." });
  });
}
