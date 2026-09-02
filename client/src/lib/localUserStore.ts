/* Modelo local BitNode: adaptador temporal para reemplazar después con Supabase/tRPC. */
export type Contract = {
  id: string;
  name: string;
  rate: string;
  amount: number;
  status:
    | "active"
    | "pending"
    | "completed"
    | "cancelled"
    | "expired"
    | "reversed";
  createdAt: string;
  duration: string;
};
export type Movement = {
  id: string;
  type: "deposit" | "withdraw" | "contract" | "yield";
  label: string;
  amount: number;
  status: "completed" | "pending";
  date: string;
  network?: string;
  wallet?: string;
  fee?: number;
  netAmount?: number;
};
export type LocalUserState = {
  username: string;
  email: string;
  balance: number;
  totalInvested: number;
  totalYield: number;
  quickBonus: number;
  binaryBonus: number;
  rankBonus: number;
  contracts: Contract[];
  movements: Movement[];
  referralCode: string;
};

const LEGACY_KEY = "bitnode-local-user-v1";
const KEY_PREFIX = "bitnode-local-user-v2";
export const initialLocalUser: LocalUserState = {
  username: "",
  email: "",
  balance: 0,
  totalInvested: 0,
  totalYield: 0,
  quickBonus: 0,
  binaryBonus: 0,
  rankBonus: 0,
  contracts: [],
  movements: [],
  referralCode: "",
};

function emptyLocalUser(): LocalUserState {
  return { ...initialLocalUser, contracts: [], movements: [] };
}

export function storageKeyForUser(userId: string) {
  return `${KEY_PREFIX}:${userId}`;
}

export function loadLocalUser(userId?: string): LocalUserState {
  if (typeof window === "undefined" || !userId) return emptyLocalUser();
  try {
    // La clave anterior era compartida entre cuentas y nunca debe migrarse.
    window.localStorage.removeItem(LEGACY_KEY);
    const saved = window.localStorage.getItem(storageKeyForUser(userId));
    return saved
      ? { ...emptyLocalUser(), ...JSON.parse(saved) }
      : emptyLocalUser();
  } catch {
    return emptyLocalUser();
  }
}

export function saveLocalUser(state: LocalUserState, userId?: string) {
  if (typeof window !== "undefined" && userId)
    window.localStorage.setItem(
      storageKeyForUser(userId),
      JSON.stringify(state)
    );
}
export function addPendingDeposit(
  state: LocalUserState,
  movement: Movement
): LocalUserState {
  return { ...state, movements: [movement, ...state.movements] };
}
export function money(value: number) {
  return `$${value.toFixed(2)}`;
}
export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
