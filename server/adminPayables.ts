export type AdminPayable = {
  id: string; username: string; amount: number | string; fee: number | string;
  net_amount: number | string; wallet: string; network: string; status: string;
  created_at: string; reference?: string | null;
  display_label?: string | null;
  sponsor_id?: string | null;
  display_date?: string | null;
  queue_after_id?: string | null;
};

export function orderWithdrawalQueue<T extends { id: string; created_at: string | null; status: string; queue_after_id?: string | null }>(rows: T[]): T[] {
  const ordered = [...rows].sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)));
  for (const row of rows) {
    if (!row.id.startsWith("PAYABLE-") || !row.queue_after_id || row.status !== "pending") continue;
    const anchor = ordered.find(item => item.id === row.queue_after_id && item.status === "pending" && !item.id.startsWith("PAYABLE-"));
    if (!anchor) continue;
    ordered.splice(ordered.indexOf(row), 1);
    ordered.splice(ordered.indexOf(anchor) + 1, 0, row);
  }
  return ordered;
}

// Payables are company obligations, not earned user commissions or wallet debits.
export function payableWithdrawal(row: AdminPayable) {
  return {
    ...row, id: `PAYABLE-${row.id}`, amount: -Math.abs(Number(row.amount)),
    user_id: null, label: row.display_label || "Retiro", provider_status: "manual_review",
    origin_label: row.display_label || "Retiro", direct_commission_spent: 0, weekly_bonus_spent: 0, node_roi_spent: 0,
  };
}
