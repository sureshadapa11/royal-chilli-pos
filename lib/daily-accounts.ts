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
