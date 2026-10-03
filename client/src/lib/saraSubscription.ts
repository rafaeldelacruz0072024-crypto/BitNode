export function saraDaysRemaining(paidThroughAt: string | null | undefined, now: number) {
  const expiry = paidThroughAt ? Date.parse(paidThroughAt) : NaN;
  return Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - now) / 86_400_000)) : null;
}
