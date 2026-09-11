export const DEPOSIT_CASHBACK_TIERS = [
  { minimum: 1000, rate: 0.2 },
  { minimum: 500, rate: 0.1 },
] as const;

export const DEPOSIT_CASHBACK_START = Date.parse("2026-09-11T00:00:00-04:00");

export function depositCashbackTransactionId(sourceTransactionId: string) {
  return `CASHBACK-${sourceTransactionId}`;
}

export function depositCashback(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return { rate: 0, amount: 0 };
  const tier = DEPOSIT_CASHBACK_TIERS.find(item => amount >= item.minimum);
  const rate = tier?.rate ?? 0;
  return { rate, amount: Number((amount * rate).toFixed(2)) };
}
