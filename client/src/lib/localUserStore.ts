/* Modelo local BitNode: adaptador temporal para reemplazar después con Supabase/tRPC. */
export type Contract = { id: string; name: string; rate: string; amount: number; status: "active" | "pending"; createdAt: string; duration: string };
export type Movement = { id: string; type: "deposit" | "withdraw" | "contract" | "yield"; label: string; amount: number; status: "completed" | "pending"; date: string; network?: string; wallet?: string; fee?: number; netAmount?: number };
export type LocalUserState = { username: string; email: string; balance: number; totalInvested: number; totalYield: number; quickBonus: number; binaryBonus: number; rankBonus: number; contracts: Contract[]; movements: Movement[]; referralCode: string };

const KEY = "bitnode-local-user-v1";
export const initialLocalUser: LocalUserState = { username: "gentecash", email: "gentecash@demo.local", balance: 0, totalInvested: 0, totalYield: 0, quickBonus: 0, binaryBonus: 0, rankBonus: 0, contracts: [], movements: [], referralCode: "gentecash" };

export function loadLocalUser(): LocalUserState {
  if (typeof window === "undefined") return initialLocalUser;
  try { const saved = window.localStorage.getItem(KEY); return saved ? { ...initialLocalUser, ...JSON.parse(saved) } : initialLocalUser; } catch { return initialLocalUser; }
}
export function saveLocalUser(state: LocalUserState) { if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(state)); }
export function money(value: number) { return `$${value.toFixed(2)}`; }
export function newId(prefix: string) { return `${prefix}-${Date.now().toString(36).toUpperCase()}`; }
