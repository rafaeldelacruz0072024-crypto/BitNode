import { supabase } from "./supabaseClient";

export type PrivateUserDetails = {
  full_name: string;
  phone: string;
  country: string;
  city: string;
  wallet_bep20: string;
};

export const emptyPrivateUserDetails: PrivateUserDetails = {
  full_name: "",
  phone: "",
  country: "",
  city: "",
  wallet_bep20: "",
};

function requireClient() {
  if (!supabase) throw new Error("El servicio no está configurado.");
  return supabase;
}

export async function fetchPrivateUserDetails(): Promise<PrivateUserDetails> {
  const client = requireClient();
  const { data: authData, error } = await client.auth.getUser();
  if (error) throw new Error(error.message);
  if (!authData.user) throw new Error("Inicia sesión para consultar tu perfil.");
  const metadata = authData.user.user_metadata || {};
  return Object.fromEntries(
    Object.keys(emptyPrivateUserDetails).map(key => [key, String(metadata[key] || "")])
  ) as PrivateUserDetails;
}

export async function savePrivateUserDetails(details: PrivateUserDetails) {
  const client = requireClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) throw new Error("Inicia sesión para guardar tu perfil.");
  const { wallet_bep20: _wallet, ...personal } = details;
  const cleaned = Object.fromEntries(Object.entries(personal).map(([key, value]) => [key, value.trim()]));
  const { error } = await client.auth.updateUser({ data: cleaned });
  if (error) throw new Error(error.message);
}

async function token() {
  const session = requireClient() ? (await requireClient().auth.getSession()).data.session : null;
  if (!session?.access_token) throw new Error("Inicia sesión para modificar tu wallet.");
  return session.access_token;
}
export async function saveWithdrawalWallet(wallet: string) {
  const response = await fetch("/api/security/wallet", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ wallet }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "No se pudo guardar la wallet."));
  return body as { message: string };
}
