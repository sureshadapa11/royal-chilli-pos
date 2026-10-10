import { bizDb } from "@/lib/business-db";

// Worked hours per staff member for a period, taken directly from live
// attendance punches (closed shifts only — clock_out set) in the shared
// database. No manager "lock" step required: hours are current the moment
// someone clocks out, and a later correction (attendance_corrections) that
// edits the underlying attendance row is reflected immediately too, since
// everything downstream always reads current state rather than a snapshot.
// Hours worked at one business — each business is a separate employer.
export async function computeHoursForPeriod(
  businessId: number,
  periodStart: string,
  periodEnd: string,
): Promise<Map<number, number>> {
  const { data: rows, error } = await bizDb(businessId)
    .from("attendance")
    .select("staff_id, net_work_seconds")
    .not("clock_out", "is", null)
    .gte("work_date", periodStart)
    .lte("work_date", periodEnd);
  if (error) throw error;

  const hoursByStaff = new Map<number, number>();
  for (const r of rows ?? []) {
    const netSeconds = Number(r.net_work_seconds ?? 0);
    hoursByStaff.set(r.staff_id, (hoursByStaff.get(r.staff_id) ?? 0) + netSeconds / 3600);
  }
  return hoursByStaff;
}

export type PayslipDay = { date: string; clock_in: string; clock_out: string; seconds: number };
export type PayslipPreview = { days: PayslipDay[]; total_seconds: number; hours_worked: number; pay_rate: number; total_amount: number };

/** What a payslip would be (pure): every closed shift, the total time, and pay = exact hours × rate. */
export function payslipTotals(days: PayslipDay[], payRate: number): PayslipPreview {
  const totalSeconds = days.reduce((s, d) => s + d.seconds, 0);
  const minutes = Math.round(totalSeconds / 60);
  return {
    days, total_seconds: totalSeconds,
    hours_worked: Math.round((minutes / 60) * 100) / 100,
    pay_rate: payRate,
    total_amount: Math.round((minutes / 60) * payRate * 100) / 100,
  };
}

/** One person's closed shifts in a date range (HR → Payslips), same source as Timesheets. */
export async function payslipDays(businessId: number, staffId: number, from: string, to: string): Promise<PayslipDay[]> {
  const { data, error } = await bizDb(businessId)
    .from("attendance")
    .select("work_date, clock_in, clock_out, net_work_seconds")
    .eq("staff_id", staffId)
    .not("clock_out", "is", null)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("clock_in");
  if (error) throw error;
  return (data ?? []).map((r) => ({ date: r.work_date, clock_in: r.clock_in, clock_out: r.clock_out, seconds: Number(r.net_work_seconds ?? 0) }));
}

export function computeGrossPay(entry: {
  base_pay: number; bonuses: number; tips: number; deductions: number; holiday_pay: number;
}): number {
  return Math.round((entry.base_pay + entry.bonuses + entry.tips + entry.holiday_pay - entry.deductions) * 100) / 100;
}
