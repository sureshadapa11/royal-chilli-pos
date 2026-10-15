import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getBusinessSetting } from "@/lib/business-settings";
import { listBusinesses } from "@/lib/business";
import { accountsByDay } from "@/lib/daily-figures";
import { addDays } from "@/lib/admin-dashboard";
import { tradingDayStr } from "@/lib/london-date";
import { r2, extractVat, getVatRate } from "@/lib/finance";
import { sendDayEndReportEmail, sendDayEndReminderEmail } from "@/lib/email";
import { staffLinkToken } from "@/lib/staff-links";
import { staffLinkUrl } from "@/lib/staff-link-url";
import { cashCategoryLabel, payMethodLabel } from "@/lib/cash-categories";
import { cashCheck } from "@/lib/daily-accounts-fields";
import { safeBook } from "@/lib/cash-book";

// Every morning: yesterday's Day End and Cash In / Out (from the staff links,
// lib/staff-links.ts), emailed to whoever is set in the business's
// "day_end_report_to" setting — only businesses with one get it.

export type CashLine = { direction: "in" | "out"; category: string; method: string; amount: number; reason: string; paidTo: string | null; by: string; place?: "till" | "safe" };

export type DayEndReport = {
  businessId: number;
  business: string;
  date: string;
  entered: { by: string; via: string | null } | null;
  figures: {
    z_report: number | null; card: number | null; cash: number | null; tips: number | null;
    platforms: { label: string; sales: number | null; commission: number | null }[];
    catering_paid: number | null; catering_pending: number | null;
    /** Events paid that day, and what all open catering / event jobs still owe (133). */
    events_paid?: number | null; jobs_owed?: number;
    /** Pending bills still owed (134). */
    bills_owed?: number;
    total_sales: number; net_total: number;
    fees: number;            // platform commissions + card fee
    // VAT (agreed 2026-10-12): sales VAT = total sales − ex-VAT; VAT claimed
    // back = the VAT inside that day's VAT-receipted expenses; to pay = the difference.
    ex_vat: number; sales_vat: number; vat_claimed: number; vat_to_pay: number;
  } | null;
  notes: string | null;
  drawer: { opening: number | null; cashSales: number; moneyIn: number; moneyOut: number; bankIn: number; expected: number | null; counted: number | null; variance: number | null };
  cash: CashLine[];
  missingDays: string[];
  /** Who worked that trading day and for how long (attendance, breaks taken off) — hours only, no pay. */
  shifts: { name: string; seconds: number; stillIn: string | null }[];
  /** The Safe after this day (136): balance and last count. */
  safe?: { balance: number; lastCount: { date: string; counted: number; difference: number } | null };
};

const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Expected cash in the drawer at close, and the difference to what was counted (pure). */
export function drawerCheck(opening: number | null, cashSales: number, moneyIn: number, moneyOut: number, counted: number | null, bankIn = 0) {
  return cashCheck({ opening, cash: cashSales, moneyIn, moneyOut, bankIn, counted });
}

export async function buildDayEndReport(businessId: number, business: string, date: string): Promise<DayEndReport> {
  const db = bizDb(businessId);
  const [{ data: row }, { data: moves }, { data: week }, figures, { data: attendance }, { data: vatExpenses }, vatRate] = await Promise.all([
    db.from("daily_accounts").select("*").eq("trading_date", date).maybeSingle(),
    db.from("cash_movements").select("direction, category, method, amount, reason, paid_to, staff_id, place").eq("movement_date", date).order("id"),
    db.from("daily_accounts").select("trading_date").eq("status", "submitted").gte("trading_date", addDays(date, -6)).lte("trading_date", date),
    accountsByDay(businessId, date, date),
    db.from("attendance").select("staff_id, clock_in, clock_out, net_work_seconds").eq("work_date", date),
    db.from("expenses").select("amount").eq("expense_date", date).eq("vat_applicable", 1),
    getVatRate(businessId),
  ]);
  const vatClaimed = r2((vatExpenses ?? []).reduce((s, e) => s + extractVat(Number(e.amount), vatRate), 0));
  const staffIds = [...new Set([row?.submitted_by, ...(moves ?? []).map((m) => m.staff_id), ...(attendance ?? []).map((a) => a.staff_id)].filter((x): x is number => !!x))];
  const { data: staff } = staffIds.length ? await supabase.from("staff").select("id, name").in("id", staffIds) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null | undefined) => (staff ?? []).find((s) => s.id === id)?.name ?? "—";

  const cash: CashLine[] = (moves ?? []).map((m) => ({
    direction: m.direction as "in" | "out", category: cashCategoryLabel(m.category), method: payMethodLabel(m.method), amount: Number(m.amount), reason: m.reason, paidTo: m.paid_to, by: nameOf(m.staff_id),
    place: (m.place === "safe" ? "safe" : "till") as "till" | "safe",
  }));
  // Only cash moves the drawer.
  // Only Till cash moves the drawer (Safe money doesn't, 136).
  const tillCash = (c: CashLine) => c.method === "Cash" && c.place !== "safe";
  const moneyIn = r2(cash.filter((c) => c.direction === "in" && tillCash(c)).reduce((s, c) => s + c.amount, 0));
  const moneyOut = r2(cash.filter((c) => c.direction === "out" && tillCash(c)).reduce((s, c) => s + c.amount, 0));
  const submitted = row?.status === "submitted";
  const cashSales = n(row?.cash) ?? 0;
  const counted = n(row?.closing_balance);
  const opening = n(row?.opening_balance);
  const day = figures.days[0];

  // Hours per person (two shifts in a day add up); a shift with no clock-out is flagged.
  const byPerson = new Map<number, { seconds: number; stillIn: string | null }>();
  for (const a of attendance ?? []) {
    const p = byPerson.get(a.staff_id) ?? { seconds: 0, stillIn: null };
    if (a.clock_out) p.seconds += Number(a.net_work_seconds ?? 0);
    else if (a.clock_in) p.stillIn = new Date(a.clock_in).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    byPerson.set(a.staff_id, p);
  }
  const shifts = [...byPerson.entries()].map(([id, p]) => ({ name: nameOf(id), ...p }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));

  // What catering / event jobs and pending bills still owed at the end of this
  // day — the month sheet's Catering / Events unpaid and Pending bills.
  const jobsOwed = r2((day?.catering_owed ?? 0) + (day?.events_owed ?? 0));
  const billsOwed = r2(day?.pending_owed ?? 0);

  // The Safe as it stood at the end of this day (136).
  const safe = await safeBook(businessId, date, date);

  const done = new Set((week ?? []).map((w) => w.trading_date as string));
  const missingDays = Array.from({ length: 7 }, (_, i) => addDays(date, -i)).filter((d) => !done.has(d)).reverse();

  return {
    businessId, business, date,
    entered: submitted ? { by: nameOf(row?.submitted_by), via: row?.submitted_via ?? null } : null,
    figures: submitted ? {
      z_report: n(row?.z_report), card: n(row?.card), cash: n(row?.cash), tips: n(row?.tips),
      platforms: [["just_eat", "Just Eat"], ["deliveroo", "Deliveroo"], ["uber_eats", "Uber Eats"], ["hiest", "Hiest"]]
        .map(([k, label]) => ({ label, sales: n(row?.[k]), commission: n(row?.[`${k}_commission`]) })),
      catering_paid: day?.sales.catering || n(row?.catering_paid), catering_pending: n(row?.catering_pending),
      events_paid: day?.sales.events || null, jobs_owed: jobsOwed, bills_owed: billsOwed,
      total_sales: day?.total_sales ?? 0, net_total: day?.net_total ?? 0,
      fees: Math.round(((day?.out.commission ?? 0) + (day?.out.card_fee ?? 0)) * 100) / 100,
      ex_vat: day?.ex_vat ?? 0,
      sales_vat: r2((day?.total_sales ?? 0) - (day?.ex_vat ?? 0)),
      vat_claimed: vatClaimed,
      vat_to_pay: r2((day?.total_sales ?? 0) - (day?.ex_vat ?? 0) - vatClaimed),
    } : null,
    notes: row?.notes ?? null,
    // Same sum as the screens (daily-figures): money out includes the till's Cash Out.
    drawer: {
      opening, cashSales, moneyIn, moneyOut: r2(moneyOut + (day?.out.paid_out ?? 0)), bankIn: n(row?.bank_in) ?? 0, counted,
      expected: day?.expected ?? null, variance: day?.variance ?? null,
    },
    cash,
    missingDays,
    shifts,
    safe: { balance: safe.balance, lastCount: safe.lastCount },
  };
}

const emails = (raw: unknown) => String(raw ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

/**
 * Each morning: yesterday's report to each business's "day_end_report_to"
 * addresses, and — when yesterday's Day End wasn't entered — a reminder to its
 * "day_end_reminder_to" addresses (agreed 2026-10-14) with the Day End link.
 */
export async function sendDayEndReports(): Promise<{ business: string; to: string[]; reminded?: string[] }[]> {
  const date = addDays(tradingDayStr(), -1);
  const out: { business: string; to: string[]; reminded?: string[] }[] = [];
  for (const b of await listBusinesses()) {
    if (!b.active) continue;
    const to = emails(await getBusinessSetting<string>(b.id, "day_end_report_to"));
    const remind = emails(await getBusinessSetting<string>(b.id, "day_end_reminder_to"));
    if (!to.length && !remind.length) continue;
    try {
      const report = await buildDayEndReport(b.id, b.name, date);
      for (const addr of to) await sendDayEndReportEmail(addr, report);
      let reminded: string[] | undefined;
      if (!report.entered && remind.length) {
        const linkUrl = staffLinkUrl(await staffLinkToken(b.id), b.domain, "https://staff.theroyalchilli.com");
        for (const addr of remind) await sendDayEndReminderEmail(addr, { businessId: b.id, business: b.name, date, linkUrl: `${linkUrl}/day-end?date=${date}`, missingDays: report.missingDays });
        reminded = remind;
      }
      out.push({ business: b.name, to, reminded });
    } catch (err) {
      console.error(`Day End report failed for ${b.name}:`, err);
    }
  }
  return out;
}
