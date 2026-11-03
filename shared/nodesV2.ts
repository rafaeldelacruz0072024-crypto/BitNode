export const NODES_V2 = [
  { id: "v2-10d", name: "Nodo 2.0 · 10 días", days: 10, rateMin: .005, rateMax: .007, min: 10 },
  { id: "v2-17d", name: "Nodo 2.0 · 17 días", days: 17, rateMin: .008, rateMax: .011, min: 10 },
  { id: "v2-33d", name: "Nodo 2.0 · 33 días", days: 33, rateMin: .013, rateMax: .021, min: 10 },
] as const;
export type NodeV2Plan = typeof NODES_V2[number];
export const isNodeV2 = (planId?: string | null) => NODES_V2.some(plan => plan.id === planId);
export const nodeVersion = (planId?: string | null): 1 | 2 => isNodeV2(planId) ? 2 : 1;
export function nodeCycleProjection(plan: NodeV2Plan, amount: number) {
  if (!Number.isFinite(amount) || amount < 0) return { min: 0, max: 0 };
  return { min: Math.round(amount * plan.rateMin * plan.days * 100) / 100,
    max: Math.round(amount * plan.rateMax * plan.days * 100) / 100 };
}
export const nodePercent = (rate: number) => (rate * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 });
