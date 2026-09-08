export const WITHDRAW_FEE_RATE = 0.05;
export const WITHDRAW_MIN_FEE = 1;

export function withdrawalFee(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(Math.max(WITHDRAW_MIN_FEE, amount * WITHDRAW_FEE_RATE) * 100) / 100;
}
