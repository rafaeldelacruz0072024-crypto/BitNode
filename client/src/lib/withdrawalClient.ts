import { supabase } from "@/lib/supabaseClient";

async function sessionToken() {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) throw new Error("Inicia sesión para solicitar un retiro.");
  return session.access_token;
}

export async function requestWithdrawal(amount: number, network: string, wallet: string) {
  const response = await fetch("/api/withdrawals/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await sessionToken()}` },
    body: JSON.stringify({ amount, network, wallet }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "No se pudo solicitar el retiro."));
  return payload as { id: string; status: string; fee: number; netAmount: number; balance: number; message: string };
}
