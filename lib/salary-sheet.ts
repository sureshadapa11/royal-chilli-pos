import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { computeHoursForPeriod } from "@/lib/payroll";

// The Salary sheet (Staff Hub → Daily accounts → Salary, agreed 2026-10-12,
// like the INSOMNIA sheet's Salary tab): per person, for a month —
//   Wages            = hours worked × pay rate (attendance, like payslips)
//   Paid (staff link)= Money OUT → "Staff wages paid" that month (cash/card/bank)
//   Advances         = given / repaid / taken off payslips that month
//   Advance owed     = everything given − repaid − taken off, up to the month end
//   Balance to pay   = wages − paid − advance owed   (never below 0)
// Seen by Super admin, HR and Supervisor only.

/** Super admin (group owner), HR and Supervisor. */
export const canSeeSalary = (s: { role: string; owner?: boolean }) => !!s.owner || ["admin", "hr", "supervisor"].includes(s.role);

export type SalaryRow = {
  staffId: number;
  name: string;
  role: string;
  hours: number;
  payRate: number;
  wages: number;
  paid: number;
  advanceGiven: number;
  advanceRepaid: number;
  advanceDeducted: number;
  advanceOwed: number;
  balance: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One person's row (pure, so it can be tested). Hours are rounded to the minute, like payslips. */
export function salaryRow(p: { staffId: number; name: string; role: string; hours: number; payRate: number; paid: number; given: number; repaid: number; deducted: number; owedToDate: number }): SalaryRow {
  const minutes = Math.round(p.hours * 60);
  const wages = r2((minutes / 60) * p.payRate);
  const owed = Math.max(0, r2(p.owedToDate));
  return {
    staffId: p.staffId, name: p.name, role: p.role,
    hours: r2(minutes / 60), payRate: p.payRate, wages, paid: r2(p.paid),
    advanceGiven: r2(p.given), advanceRepaid: r2(p.repaid), advanceDeducted: r2(p.deducted), advanceOwed: owed,
    balance: Math.max(0, r2(wages - p.paid - owed)),
  };
}

export async function salarySheet(businessId: number, from: string, to: string): Promise<SalaryRow[]> {
  const db = bizDb(businessId);
  const [hours, { data: staff }, { data: paidRows }, { data: adv }] = await Promise.all([
    computeHoursForPeriod(businessId, from, to),
    supabase.from("staff").select("id, name, role, pay_rate, active").eq("business_id", businessId).order("name"),
    db.from("cash_movements").select("staff_member_id, amount").eq("category", "wages").gte("movement_date", from).lte("movement_date", to),
    db.from("staff_advances").select("staff_id, kind, amount, advance_date").lte("advance_date", to),
  ]);
  const paid = new Map<number, number>();
  for (const p of paidRows ?? []) if (p.staff_member_id) paid.set(p.staff_member_id, (paid.get(p.staff_member_id) ?? 0) + Number(p.amount));
  const sumAdv = (id: number, kind: string, inMonth: boolean) =>
    (adv ?? []).filter((a) => a.staff_id === id && a.kind === kind && (!inMonth || a.advance_date >= from)).reduce((s, a) => s + Number(a.amount), 0);

  return (staff ?? [])
    .map((s) => salaryRow({
      staffId: s.id, name: s.name, role: s.role, hours: hours.get(s.id) ?? 0, payRate: Number(s.pay_rate ?? 0), paid: paid.get(s.id) ?? 0,
      given: sumAdv(s.id, "advance", true), repaid: sumAdv(s.id, "repaid", true), deducted: sumAdv(s.id, "deducted", true),
      owedToDate: sumAdv(s.id, "advance", false) - sumAdv(s.id, "repaid", false) - sumAdv(s.id, "deducted", false),
    }))
    // Everyone active, plus anyone who left but has something this month.
    .filter((r, i) => (staff![i].active === 1 || (staff![i].active as unknown) === true) || r.hours > 0 || r.paid > 0 || r.advanceOwed > 0 || r.advanceGiven > 0);
}
