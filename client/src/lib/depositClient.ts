import { supabase } from "./supabaseClient";

export async function requestManualDeposit(amount: number) {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error("Inicia sesión para registrar depósitos.");

  const response = await fetch("/api/deposits/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "No se pudo registrar el depósito."));
  return payload as { id: string; status: "pending"; credited: false; message: string };
}
