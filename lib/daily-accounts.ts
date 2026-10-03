import { bizDb } from "@/lib/business-db";
import { tradingRangeUtc } from "@/lib/london-date";
import { getSalesData, r2 } from "@/lib/finance";
import { getZReport } from "@/lib/z-report-db";
import type { ZReport } from "@/lib/z-report";
import { DAILY_KEYS, type DailyValues } from "@/lib/daily-accounts-fields";

// Day-end accounts (Staff Hub → Daily accounts). The till's figures for a
// trading day, to pre-fill the manager's sheet: the Z report of every shift
// opened that day (net sales, card, cash, opening and counted closing cash,
// pay-later bills left unpaid), takeaway sales, and the delivery platforms'
// totals typed in that day. Anything the till doesn't know is null.

export const blankValues = (): DailyValues =>
  Object.fromEntries(DAILY_KEYS.map((k) => [k, null])) as DailyValues;

/** Combine the shifts' Z reports for one day (pure, so it can be tested). */
export function fromZReports(reports: ZReport[]): Partial<DailyValues> {
  if (reports.length === 0) return {};
  const sum = (f: (z: ZReport) => number) => r2(reports.reduce((s, z) => s + f(z), 0));
  const last = reports[reports.length - 1];
  return {
    z_report: sum((z) => z.net_sales),
    card: sum((z) => z.payments.card),
    cash: sum((z) => z.payments.cash),
    pending: sum((z) => z.other.pending_bills.reduce((s, b) => s + b.balance, 0)),
    opening_balance: r2(reports[0].cash.opening),
    closing_balance: last.cash.counted != null ? r2(last.cash.counted) : r2(last.cash.expected),
  };
}

export async function tillFigures(businessId: number, date: string): Promise<DailyValues> {
  const { start, end } = tradingRangeUtc(date);
  const { data: periods } = await bizDb(businessId).from("work_periods").select("id")
    .gte("opened_at", start).lte("opened_at", end).order("opened_at");
  const [reports, sales] = await Promise.all([
    Promise.all((periods ?? []).map((p) => getZReport(p.id))),
    getSalesData(businessId, date, date),
  ]);

  const values = { ...blankValues(), ...fromZReports(reports.filter((z): z is ZReport => !!z)) };

  const takeaway = sales.orders.filter((o) => o.order_type === "takeaway").reduce((s, o) => s + Number(o.total), 0)
    - sales.refunds.filter((r) => r.order_type === "takeaway").reduce((s, r) => s + r.amount, 0);
  if (takeaway !== 0 || reports.length) values.takeaway = r2(takeaway);

  for (const p of sales.platforms) {
    const key = p.platform as keyof DailyValues;
    if (key in values) values[key] = r2((values[key] ?? 0) + Number(p.sales));
  }
  if (sales.platforms.length) values.commission = r2(sales.platforms.reduce((s, p) => s + Number(p.commission), 0));
  return values;
}

// ── The month sheet and the dashboard's Summary ──────────────────────────────

export type DailyRow = Partial<Record<keyof DailyValues, number | string | null>> & {
  trading_date: string; notes: string | null; status: "draft" | "submitted";
};

const SHEET_COLUMNS = ["trading_date", ...DAILY_KEYS, "notes", "status"].join(", ");

/** Every saved day (draft or submitted) from `from` to `to`, oldest first. */
export async function savedDays(businessId: number, from: string, to: string): Promise<DailyRow[]> {
  const { data, error } = await bizDb(businessId).from("daily_accounts").select(SHEET_COLUMNS)
    .gte("trading_date", from).lte("trading_date", to).order("trading_date");
  if (error) throw error;
  return (data ?? []) as unknown as DailyRow[];
}

/** Month total row: every field added up on its own, like the paper sheet. */
export function columnTotals(rows: DailyRow[]): DailyValues {
  const t = blankValues();
  for (const k of DAILY_KEYS) {
    const vals = rows.map((r) => r[k]).filter((v) => v != null && v !== "");
    t[k] = vals.length ? r2(vals.reduce<number>((s, v) => s + Number(v), 0)) : null;
  }
  return t;
}

export type DailySummary = {
  bankIn: number;
  cash: number;
  notBanked: number;
  pending: number;
  cateringPaid: number;
  cateringPending: number;
  opening: number | null; // first entered day's opening balance
  closing: number | null; // last entered day's closing balance
  submitted: number;      // days submitted…
  daysSoFar: number;      // …out of the period's days up to today
  missing: string[];      // days so far with nothing submitted
};

/** The Summary card's Daily accounts section for a period (pure). */
export function summarise(rows: DailyRow[], from: string, to: string, today: string): DailySummary {
  const t = columnTotals(rows);
  const n = (v: number | null) => v ?? 0;
  const days: string[] = [];
  for (let d = from; d <= to && d <= today; ) {
    days.push(d);
    const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10);
  }
  const submitted = new Set(rows.filter((r) => r.status === "submitted").map((r) => r.trading_date));
  const withOpening = rows.filter((r) => r.opening_balance != null && r.opening_balance !== "");
  const withClosing = rows.filter((r) => r.closing_balance != null && r.closing_balance !== "");
  return {
    bankIn: n(t.bank_in),
    cash: n(t.cash),
    notBanked: r2(n(t.cash) - n(t.bank_in)),
    pending: n(t.pending),
    cateringPaid: n(t.catering_paid),
    cateringPending: n(t.catering_pending),
    opening: withOpening.length ? r2(Number(withOpening[0].opening_balance)) : null,
    closing: withClosing.length ? r2(Number(withClosing[withClosing.length - 1].closing_balance)) : null,
    submitted: days.filter((d) => submitted.has(d)).length,
    daysSoFar: days.length,
    missing: days.filter((d) => !submitted.has(d)),
  };
}
