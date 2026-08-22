import { supabase } from "@/lib/supabaseClient";

export async function requestWithdrawal(amount: number, network: string, wallet: string) {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session?.access_token) throw new Error("Inicia sesión para solicitar un retiro.");
  const response = await fetch("/api/withdrawals/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ amount, network, wallet }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "No se pudo registrar el retiro."));
  return payload as { id: string; status: "pending"; fee: number; netAmount: number; message: string };
}
