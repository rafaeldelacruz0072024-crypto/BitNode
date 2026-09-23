export type WithdrawalSource = "direct" | "wednesday" | "mixed" | "unclassified";

export type WithdrawalSourceInput = {
  directCommissionSpent?: number | string | null;
  weeklyBonusSpent?: number | string | null;
  nodeRoiSpent?: number | string | null;
};

const positive = (value: number | string | null | undefined) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

export function withdrawalSource(input: WithdrawalSourceInput) {
  const direct = positive(input.directCommissionSpent);
  const wednesday = positive(input.weeklyBonusSpent) + positive(input.nodeRoiSpent);
  const source: WithdrawalSource = direct > 0 && wednesday > 0
    ? "mixed"
    : direct > 0
      ? "direct"
      : wednesday > 0
        ? "wednesday"
        : "unclassified";
  return { source, direct, wednesday };
}

export const withdrawalSourceLabel: Record<WithdrawalSource, string> = {
  direct: "Comisión directa",
  wednesday: "Comisiones del miércoles",
  mixed: "Origen mixto",
  unclassified: "Origen no registrado",
};
