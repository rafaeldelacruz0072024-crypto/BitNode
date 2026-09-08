import { z } from "zod";

export const roiMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const percentage = z.number().finite().min(0).max(1000).refine(
  value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Usa hasta dos decimales."
);
export const monthlyRatesSchema = z.object({
  daily: percentage, seven: percentage, fourteen: percentage, twentyOne: percentage,
}).strict();
export type MonthlyRates = z.infer<typeof monthlyRatesSchema>;
export const monthlyRoiInput = z.object({
  month: roiMonthSchema,
  rates: monthlyRatesSchema,
  version: z.number().int().nonnegative(),
}).strict();

export function businessDaysInMonth(month: string) {
  if (!roiMonthSchema.safeParse(month).success) return 0;
  const [year, number] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, number, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= end; day++) {
    const weekday = new Date(Date.UTC(year, number - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}
