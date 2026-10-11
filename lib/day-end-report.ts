import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getBusinessSetting } from "@/lib/business-settings";
import { listBusinesses } from "@/lib/business";
import { accountsByDay } from "@/lib/daily-figures";
import { addDays } from "@/lib/admin-dashboard";
import { tradingDayStr } from "@/lib/london-date";
import { r2 } from "@/lib/finance";
import { sendDayEndReportEmail } from "@/lib/email";

// Every morning: yesterday's Day End and Cash In / Out (from the staff links,
// lib/staff-links.ts), emailed to whoever is set in the business's
// "day_end_report_to" setting — only businesses with one get it.

export type CashLine = { direction: "in" | "out"; amount: number; reason: string; paidTo: string | null; by: string };

export type DayEndReport = {
  businessId: number;
  business: string;
  date: string;
  entered: { by: string; via: string | null } | null;
  figures: {
    z_report: number | null; card: number | null; cash: number | null; tips: number | null;
    platforms: { label: string; sales: number | null; commission: number | null }[];
    catering_paid: number | null; catering_pending: number | null;
    total_sales: number; net_total: number;
  } | null;
  notes: string | null;
  drawer: { opening: number | null; cashSales: number; moneyIn: number; moneyOut: number; expected: number | null; counted: number | null; variance: number | null };
  cash: CashLine[];
  missingDays: string[];
};

const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Expected cash in the drawer at close, and the difference to what was counted (pure). */
export function drawerCheck(opening: number | null, cashSales: number, moneyIn: number, moneyOut: number, counted: number | null) {
  const expected = opening == null ? null : r2(opening + cashSales + moneyIn - moneyOut);
  return { expected, variance: expected == null || counted == null ? null : r2(counted - expected) };
}

export async function buildDayEndReport(businessId: number, business: string, date: string): Promise<DayEndReport> {
  const db = bizDb(businessId);
  const [{ data: row }, { data: moves }, { data: week }, figures] = await Promise.all([
    db.from("daily_accounts").select("*").eq("trading_date", date).maybeSingle(),
    db.from("cash_movements").select("direction, amount, reason, paid_to, staff_id").eq("movement_date", date).order("id"),
    db.from("daily_accounts").select("trading_date").eq("status", "submitted").gte("trading_date", addDays(date, -6)).lte("trading_date", date),
    accountsByDay(businessId, date, date),
  ]);
  const staffIds = [...new Set([row?.submitted_by, ...(moves ?? []).map((m) => m.staff_id)].filter((x): x is number => !!x))];
  const { data: staff } = staffIds.length ? await supabase.from("staff").select("id, name").in("id", staffIds) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null | undefined) => (staff ?? []).find((s) => s.id === id)?.name ?? "—";

  const cash: CashLine[] = (moves ?? []).map((m) => ({
    direction: m.direction as "in" | "out", amount: Number(m.amount), reason: m.reason, paidTo: m.paid_to, by: nameOf(m.staff_id),
  }));
  const moneyIn = r2(cash.filter((c) => c.direction === "in").reduce((s, c) => s + c.amount, 0));
  const moneyOut = r2(cash.filter((c) => c.direction === "out").reduce((s, c) => s + c.amount, 0));
  const submitted = row?.status === "submitted";
  const cashSales = n(row?.cash) ?? 0;
  const counted = n(row?.closing_balance);
  const opening = n(row?.opening_balance);
  const day = figures.days[0];

  const done = new Set((week ?? []).map((w) => w.trading_date as string));
  const missingDays = Array.from({ length: 7 }, (_, i) => addDays(date, -i)).filter((d) => !done.has(d)).reverse();

  return {
    businessId, business, date,
    entered: submitted ? { by: nameOf(row?.submitted_by), via: row?.submitted_via ?? null } : null,
    figures: submitted ? {
      z_report: n(row?.z_report), card: n(row?.card), cash: n(row?.cash), tips: n(row?.tips),
      platforms: [["just_eat", "Just Eat"], ["deliveroo", "Deliveroo"], ["uber_eats", "Uber Eats"], ["hiest", "Hiest"]]
        .map(([k, label]) => ({ label, sales: n(row?.[k]), commission: n(row?.[`${k}_commission`]) })),
      catering_paid: n(row?.catering_paid), catering_pending: n(row?.catering_pending),
      total_sales: day?.total_sales ?? 0, net_total: day?.net_total ?? 0,
    } : null,
    notes: row?.notes ?? null,
    drawer: { opening, cashSales, moneyIn, moneyOut, counted, ...drawerCheck(opening, cashSales, moneyIn, moneyOut, counted) },
    cash,
    missingDays,
  };
}

/** Yesterday's report to each business that has a "day_end_report_to" address. */
export async function sendDayEndReports(): Promise<{ business: string; to: string[] }[]> {
  const date = addDays(tradingDayStr(), -1);
  const out: { business: string; to: string[] }[] = [];
  for (const b of await listBusinesses()) {
    if (!b.active) continue;
    const raw = await getBusinessSetting<string>(b.id, "day_end_report_to");
    const to = String(raw ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!to.length) continue;
    try {
      const report = await buildDayEndReport(b.id, b.name, date);
      for (const addr of to) await sendDayEndReportEmail(addr, report);
      out.push({ business: b.name, to });
    } catch (err) {
      console.error(`Day End report failed for ${b.name}:`, err);
    }
  }
  return out;
}
