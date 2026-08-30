import { supabase } from "@/lib/supabaseClient";

export async function createNowPaymentsPayment(amount: number, payCurrency = "usdtbsc") {
  if (!supabase) throw new Error("El servicio de pagos no está configurado.");
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) throw new Error("Inicia sesión para crear un pago.");
  const response = await fetch("/api/payments/nowpayments/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ amount, payCurrency }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.error || "NOWPayments rechazó la solicitud."));
  return payload as {
    transactionId: string;
    paymentId: string;
    payAddress: string;
    payAmount: string;
    payCurrency: string;
    status: string;
  };
}
