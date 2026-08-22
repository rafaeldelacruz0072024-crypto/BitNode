import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export type SupabaseAuthState = { session: Session | null; user: User | null; loading: boolean };

export function displayAuthName(user: User | null) {
  if (!user) return "Invitado";
  return String(user.user_metadata?.username || user.user_metadata?.name || user.email?.split("@")[0] || "Usuario");
}
