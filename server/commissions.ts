import { calculateDirectCommission, DIRECT_COMMISSION_RATE } from "./commissionRules";

export type ContractCommissionInput = {
  sourceEventId: string;
  contractId: string;
  userId: string;
  amount: number;
  eventType?: "contract_confirmed" | "contract_reversed";
};

function supabaseConfig() {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured.");
  return { baseUrl, serviceKey };
}

/**
 * Calls the idempotent database RPC. The browser never calls this function and
 * never receives the service role key. The database remains the source of truth
 * for sponsor selection, ledger writes and binary matching.
 */
export async function processContractCommissions(input: ContractCommissionInput) {
  if (!input.sourceEventId.trim() || !input.contractId.trim() || !input.userId.trim()) throw new Error("event identifiers are required");
  const expectedDirect = calculateDirectCommission(input.amount);
  const { baseUrl, serviceKey } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/rpc/process_contract_commissions`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_source_event_id: input.sourceEventId, p_contract_id: input.contractId, p_user_id: input.userId, p_amount: input.amount, p_event_type: input.eventType ?? "contract_confirmed" }),
  });
  if (!response.ok) throw new Error(`process_contract_commissions failed with ${response.status}`);
  const result = await response.json();
  return { ...result, configuredDirectRate: DIRECT_COMMISSION_RATE, expectedDirectCommission: expectedDirect };
}
