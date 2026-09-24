type Deposit = {
  id: string; user_id?: string | null; type?: string | null; status?: string | null;
  amount?: number | string | null; provider_status?: string | null; provider_payment_id?: string | null;
};
type Corporate = { user_id: string; source_deposit_id?: string | null };
export function classifyUsers(deposits: Deposit[], corporate: Corporate[]) {
  const labels = new Map<string, Set<string>>();
  const add = (id: string, label: string) => {
    if (!labels.has(id)) labels.set(id, new Set());
    labels.get(id)!.add(label);
  };
  const corporateDeposits = new Set(corporate.map(row => row.source_deposit_id).filter(Boolean));
  corporate.forEach(row => add(row.user_id, "ADM (CORPORATIVA)"));
  for (const row of deposits) {
    if (!row.user_id || row.type !== "deposit" || row.status !== "completed" || !(Number(row.amount) > 0)) continue;
    if (row.id.startsWith("NP-") && row.provider_payment_id && ["finished", "confirmed"].includes(row.provider_status || "")) add(row.user_id, "CRYPTO");
    if (row.id.startsWith("ADMIN-") && row.provider_status?.startsWith("admin_manual:") && !corporateDeposits.has(row.id)) add(row.user_id, "REALES MANUAL");
  }
  return labels;
}
