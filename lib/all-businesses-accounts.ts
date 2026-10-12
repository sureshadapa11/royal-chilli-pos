import { listBusinesses } from "@/lib/business";
import { accountsByDay, totalFigures } from "@/lib/daily-figures";
import { cashBook } from "@/lib/cash-book";
import { monthRange } from "@/lib/daily-accounts-workbook";
import { addDays } from "@/lib/admin-dashboard";
import { tradingDayStr } from "@/lib/london-date";

// Super admin → Daily accounts with "Working in: All businesses" (agreed
// 2026-10-12, like the INSOMNIA sheet's Summary tab): every business's month
// side by side. Each business keeps its own cash drawer and figures.

export type BusinessMonth = {
  businessId: number;
  name: string;
  totalSales: number;
  exVat: number;
  commission: number;     // platform commissions + card fee
  moneyOut: number;
  netTotal: number;
  cashVariance: number | null;   // the month's cash book variance (counted − expected)
  cashNow: number | null;        // cash in the drawer at the last entered day
  dayEnds: number;               // days submitted this month
  missing: number;               // days with no Day End (from the first one, up to yesterday)
  lastDayEnd: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function businessMonth(b: { id: number; name: string }, month: string): Promise<BusinessMonth> {
  const { from, to } = monthRange(month);
  const [{ days, rows }, book] = await Promise.all([accountsByDay(b.id, from, to), cashBook(b.id, from, to)]);
  const t = totalFigures(days);
  const submitted = rows.filter((r) => r.status === "submitted").map((r) => r.trading_date).sort();
  // Missing = days from the business's first Day End (or the month start) up to yesterday with none.
  const yesterday = addDays(tradingDayStr(), -1);
  const firstEver = book.start;
  let missing = 0;
  if (firstEver) {
    const done = new Set(submitted);
    for (let d = from < firstEver ? firstEver : from; d <= to && d <= yesterday; d = addDays(d, 1)) if (!done.has(d)) missing++;
  }
  const withVar = book.days.filter((d) => d.variance != null);
  const last = [...book.days].reverse().find((d) => d.carry != null);
  return {
    businessId: b.id, name: b.name,
    totalSales: t.total_sales, exVat: t.ex_vat, commission: r2(t.out.commission + t.out.card_fee),
    moneyOut: t.money_out, netTotal: t.net_total,
    cashVariance: withVar.length ? r2(withVar.reduce((s, d) => s + (d.variance ?? 0), 0)) : null,
    cashNow: last?.carry ?? null,
    dayEnds: submitted.length, missing,
    lastDayEnd: submitted.length ? submitted[submitted.length - 1] : null,
  };
}

/** Every business's month (open ones first), in the group's order; `active` false = not open yet. */
export async function allBusinessesMonth(month: string): Promise<(BusinessMonth & { active: boolean; code: string | null })[]> {
  const list = [...(await listBusinesses())].sort((a, b) => Number(b.active) - Number(a.active));
  return Promise.all(list.map(async (b) => ({ ...(await businessMonth(b, month)), active: !!b.active, code: b.login_code ?? null })));
}
