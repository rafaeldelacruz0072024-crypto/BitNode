import { supabase } from "./supabaseClient";

export type PrivateUserDetails = {
  full_name: string;
  phone: string;
  country: string;
  city: string;
  wallet_bep20: string;
  wallet_trc20: string;
};

export const emptyPrivateUserDetails: PrivateUserDetails = {
  full_name: "",
  phone: "",
  country: "",
  city: "",
  wallet_bep20: "",
  wallet_trc20: "",
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
  const cleaned = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()]));
  const { error } = await client.auth.updateUser({ data: cleaned });
  if (error) throw new Error(error.message);
}
