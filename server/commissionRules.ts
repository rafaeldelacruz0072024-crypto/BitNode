export const DIRECT_COMMISSION_RATE = 0.10;

/** Calculates the direct-referral commission in USDT-equivalent units. */
export function calculateDirectCommission(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be positive");
  return Math.round(amount * DIRECT_COMMISSION_RATE * 100_000_000) / 100_000_000;
}

export function isDirectCommissionRate(rate: number): boolean {
  return Number.isFinite(rate) && rate === DIRECT_COMMISSION_RATE;
}
