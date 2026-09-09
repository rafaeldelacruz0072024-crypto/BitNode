export type CycleReward = { contract_id: string; amount: number | string; status: string; created_at: string };

export function nodeProgress(rows: CycleReward[], contractId: string, duration: number | null, cycleDay: number, resetAt: string | null) {
  const eligible = rows.filter(row => row.contract_id === contractId &&
    (duration ? row.status === "pending" : row.status === "completed") &&
    (!resetAt || row.created_at > resetAt))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const current = cycleDay === 0 ? [] : duration ? eligible : eligible.slice(0, cycleDay);
  return { days: current.length, earnings: current.reduce((sum, row) => sum + Number(row.amount), 0) };
}
