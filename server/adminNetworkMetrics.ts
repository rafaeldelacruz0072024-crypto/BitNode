type NetworkProfile = { id: string; sponsor_id?: string | null };
type NetworkContract = { user_id?: string | null; amount?: number | string | null; status?: string | null };

export type AdminNetworkMetric = {
  userId: string;
  directCount: number;
  indirectCount: number;
  networkCount: number;
  personalVolume: number;
  networkVolume: number;
  organizationVolume: number;
};

const amount = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Calculates sponsorship-tree metrics from the immutable profiles.sponsor_id relationship. */
export function calculateAdminNetworkMetrics(profiles: NetworkProfile[], contracts: NetworkContract[]): AdminNetworkMetric[] {
  const profileIds = new Set(profiles.map(profile => profile.id));
  const children = new Map<string, string[]>();
  const volumeByUser = new Map<string, number>();

  for (const profile of profiles) {
    if (!profile.sponsor_id || !profileIds.has(profile.sponsor_id) || profile.sponsor_id === profile.id) continue;
    children.set(profile.sponsor_id, [...(children.get(profile.sponsor_id) ?? []), profile.id]);
  }

  for (const contract of contracts) {
    if (!contract.user_id || contract.status === "failed") continue;
    volumeByUser.set(contract.user_id, (volumeByUser.get(contract.user_id) ?? 0) + Math.abs(amount(contract.amount)));
  }

  return profiles.map(profile => {
    const directIds = children.get(profile.id) ?? [];
    const descendants = new Set<string>();
    const pending = [...directIds];
    while (pending.length) {
      const userId = pending.pop()!;
      if (userId === profile.id || descendants.has(userId)) continue;
      descendants.add(userId);
      pending.push(...(children.get(userId) ?? []));
    }
    const networkVolume = Array.from(descendants).reduce((sum, userId) => sum + (volumeByUser.get(userId) ?? 0), 0);
    const personalVolume = volumeByUser.get(profile.id) ?? 0;
    return {
      userId: profile.id,
      directCount: directIds.length,
      indirectCount: Math.max(0, descendants.size - directIds.length),
      networkCount: descendants.size,
      personalVolume: round(personalVolume),
      networkVolume: round(networkVolume),
      organizationVolume: round(personalVolume + networkVolume),
    };
  });
}
