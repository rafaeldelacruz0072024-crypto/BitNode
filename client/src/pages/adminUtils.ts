export function matchesAdminSearch(values: Array<string | null | undefined>, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

export function userStatusLabel(user: { status?: string | null; emailConfirmedAt?: string | null; bannedUntil?: string | null }, now = Date.now()) {
  if (user.bannedUntil) {
    const bannedUntil = new Date(user.bannedUntil).getTime();
    if (Number.isFinite(bannedUntil) && bannedUntil > now) return "suspendido";
  }
  return user.emailConfirmedAt ? "activo" : "pendiente";
}

export function hasRows<T>(rows: T[] | null | undefined) {
  return Array.isArray(rows) && rows.length > 0;
}
