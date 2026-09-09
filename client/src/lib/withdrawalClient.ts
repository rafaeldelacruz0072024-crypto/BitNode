import { supabase } from "@/lib/supabaseClient";

async function sessionToken() {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) throw new Error("Inicia sesión para solicitar un retiro.");
  return session.access_token;
}

export async function requestWithdrawal(amount: number, network: string, wallet: string) {
  const response = await fetch("/api/security/email-code/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await sessionToken()}` },
    body: JSON.stringify({ purpose: "withdrawal", payload: { amount, network, wallet } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "No se pudo enviar el código."));
  return payload as { challengeId: string; maskedEmail: string; expiresInSeconds: number };
}

export async function confirmWithdrawal(challengeId: string, code: string) {
  const response = await fetch("/api/security/email-code/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await sessionToken()}` },
    body: JSON.stringify({ challengeId, code }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "No se pudo confirmar el retiro."));
  return payload as { id: string; status: "pending"; fee: number; netAmount: number; message: string };
}
