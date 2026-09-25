export type ReconciliationDay = {
  date: string;
  incoming: { crypto: number; manual: number; capitalReturned: number; other: number };
  withdrawalRequests: { gross: number };
  commissions: { direct: number; other: number };
  cancelledNodes: number;
};

export type WeeklyReconciliation = {
  from: string;
  to: string;
  days: number;
  incoming: ReconciliationDay["incoming"];
  withdrawalRequests: ReconciliationDay["withdrawalRequests"];
  commissions: ReconciliationDay["commissions"];
  cancelledNodes: number;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function mondayOf(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  const weekday = day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return day.toISOString().slice(0, 10);
}

export function groupWeeklyReconciliation(days: ReconciliationDay[]): WeeklyReconciliation[] {
  const weeks = new Map<string, WeeklyReconciliation>();
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = mondayOf(day.date);
    const week = weeks.get(key) ?? {
      from: day.date,
      to: day.date,
      days: 0,
      incoming: { crypto: 0, manual: 0, capitalReturned: 0, other: 0 },
      withdrawalRequests: { gross: 0 },
      commissions: { direct: 0, other: 0 },
      cancelledNodes: 0,
    };
    week.to = day.date;
    week.days += 1;
    week.incoming.crypto = round(week.incoming.crypto + day.incoming.crypto);
    week.incoming.manual = round(week.incoming.manual + day.incoming.manual);
    week.incoming.capitalReturned = round(week.incoming.capitalReturned + day.incoming.capitalReturned);
    week.incoming.other = round(week.incoming.other + day.incoming.other);
    week.withdrawalRequests.gross = round(week.withdrawalRequests.gross + day.withdrawalRequests.gross);
    week.commissions.direct = round(week.commissions.direct + day.commissions.direct);
    week.commissions.other = round(week.commissions.other + day.commissions.other);
    week.cancelledNodes += day.cancelledNodes;
    weeks.set(key, week);
  }
  return Array.from(weeks.values());
}
