export type AdminPayable = {
  id: string; username: string; amount: number | string; fee: number | string;
  net_amount: number | string; wallet: string; network: string; status: string;
  created_at: string; reference?: string | null;
};

// Payables are company obligations, not earned user commissions or wallet debits.
export function payableWithdrawal(row: AdminPayable) {
  return {
    ...row, id: `PAYABLE-${row.id}`, amount: -Math.abs(Number(row.amount)),
    user_id: null, label: "Retiro", provider_status: "manual_review",
    origin_label: "Retiro", direct_commission_spent: 0, weekly_bonus_spent: 0, node_roi_spent: 0,
  };
}
