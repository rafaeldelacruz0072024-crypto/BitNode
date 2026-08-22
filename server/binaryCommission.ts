export const BINARY_COMMISSION_RATE = 0.10;

export type BinaryVolume = { left: number; right: number; previouslyMatched?: number };

export function calculateMatchedVolume({ left, right, previouslyMatched = 0 }: BinaryVolume): number {
  if (![left, right, previouslyMatched].every(Number.isFinite) || left < 0 || right < 0 || previouslyMatched < 0) throw new Error("binary volumes must be non-negative");
  return Math.max(Math.min(left, right) - previouslyMatched, 0);
}

export function calculateBinaryCommission(volume: BinaryVolume): number {
  return Math.round(calculateMatchedVolume(volume) * BINARY_COMMISSION_RATE * 100_000_000) / 100_000_000;
}

export function binaryPairingStatus(left: number, right: number): "paired" | "awaiting_pair" | "no_volume" {
  if (left < 0 || right < 0 || !Number.isFinite(left) || !Number.isFinite(right)) throw new Error("binary volumes must be non-negative");
  return Math.min(left, right) > 0 ? "paired" : left > 0 || right > 0 ? "awaiting_pair" : "no_volume";
}
