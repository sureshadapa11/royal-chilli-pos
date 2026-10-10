import { bizDb } from "@/lib/business-db";
import { allRows, r2 } from "@/lib/finance";
import { accountsByDay, type MoneyOut } from "@/lib/daily-figures";
import type { RangeKey } from "@/lib/admin-dashboard";
import { CARD_PLATFORMS, type CardPlatform } from "@/lib/dashboard-cards-meta";

// The dashboard cards that work without the till: everything comes from what
// is entered by hand — Daily accounts (Z report, card, cash, platforms and
// their commission, catering, opening/closing cash), Expenses, stock
// deliveries and Attendance — using the same day-by-day sums as the Summary
// card (lib/daily-figures.ts). Each card shows the chosen period next to the
// one before it.

export { CARD_PLATFORMS, type CardPlatform };

export type CardDay = {
  date: string;
  sheet: boolean;          // a Daily accounts sheet exists for the day
  tillOnly: boolean;       // no sheet figure, the till's own payments were used
  total: number;           // Total sales
  exVat: number;
  net: number;             // Net total
  moneyOut: number;
  out: MoneyOut;
  variance: number | null; // closing − opening
  till: number;            // Z report
  catering: number;
  platforms: Record<CardPlatform, { sales: number; commission: number }>;
  card: number;
  cash: number;
  bankIn: number;
  tips: number;
  hours: number;           // clocked hours (Attendance)
};

export type CardPeriod = { from: string; to: string; days: CardDay[] };
export type DashboardCards = { range: RangeKey; today: string; cur: CardPeriod; prev: CardPeriod };

const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** The period before: the week before, or the whole month before. */
export function previousPeriod(range: RangeKey, cur: { from: string; to: string }): { from: string; to: string } {
  if (range === "today") return { from: addDays(cur.from, -7), to: addDays(cur.to, -7) };
  if (range.endsWith("week")) return { from: addDays(cur.from, -7), to: addDays(cur.to, -7) };
  const first = new Date(cur.from + "T00:00:00Z");
  first.setUTCMonth(first.getUTCMonth() - 1);
  return { from: first.toISOString().slice(0, 10), to: addDays(cur.from, -1) };
}

async function hoursByDay(businessId: number, from: string, to: string): Promise<Map<string, number>> {
  const rows = await allRows<{ work_date: string; net_work_seconds: number | null }>((a, b) =>
    bizDb(businessId).from("attendance").select("work_date, net_work_seconds")
      .gte("work_date", from).lte("work_date", to).not("clock_out", "is", null).order("id").range(a, b));
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.work_date, (out.get(r.work_date) ?? 0) + Number(r.net_work_seconds ?? 0) / 3600);
  return out;
}

/** Every day from..to with the figures the cards need. */
export async function cardDays(businessId: number, from: string, to: string): Promise<CardDay[]> {
  const [{ days, rows }, hours] = await Promise.all([accountsByDay(businessId, from, to), hoursByDay(businessId, from, to)]);
  const byDate = new Map(rows.map((r) => [r.trading_date, r]));
  const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
  return days.map((d) => {
    const r = byDate.get(d.date);
    const platforms = Object.fromEntries(CARD_PLATFORMS.map(({ key }) => [key, {
      sales: n(r?.[key]),
      commission: n(r?.[`${key}_commission` as keyof typeof r]),
    }])) as CardDay["platforms"];
    return {
      date: d.date, sheet: !!r, tillOnly: d.till_fallback,
      total: d.total_sales, exVat: d.ex_vat, net: d.net_total, moneyOut: d.money_out, out: d.out, variance: d.variance,
      till: d.sales.till, catering: d.sales.catering, platforms,
      card: n(r?.card), cash: n(r?.cash), bankIn: n(r?.bank_in), tips: n(r?.tips),
      hours: r2(hours.get(d.date) ?? 0),
    };
  });
}

export async function getDashboardCards(businessId: number, range: RangeKey, cur: { from: string; to: string }, today: string): Promise<DashboardCards> {
  const prev = previousPeriod(range, cur);
  const days = await cardDays(businessId, prev.from, cur.to);
  return {
    range, today,
    cur: { ...cur, days: days.filter((d) => d.date >= cur.from) },
    prev: { ...prev, days: days.filter((d) => d.date <= prev.to) },
  };
}

/** Several businesses' days added together, day by day (owner's "All businesses"). Pure. */
export function mergeCardDays(lists: CardDay[][]): CardDay[] {
  const [first, ...rest] = lists;
  if (!first) return [];
  return first.map((day, i) => rest.reduce<CardDay>((a, list) => {
    const b = list[i];
    if (!b) return a;
    const out = Object.fromEntries(Object.keys(a.out).map((k) => [k, r2(a.out[k as keyof MoneyOut] + b.out[k as keyof MoneyOut])])) as MoneyOut;
    const platforms = Object.fromEntries(CARD_PLATFORMS.map(({ key }) => [key, {
      sales: r2(a.platforms[key].sales + b.platforms[key].sales),
      commission: r2(a.platforms[key].commission + b.platforms[key].commission),
    }])) as CardDay["platforms"];
    return {
      date: a.date, sheet: a.sheet || b.sheet, tillOnly: !(a.sheet || b.sheet) && (a.tillOnly || b.tillOnly),
      total: r2(a.total + b.total), exVat: r2(a.exVat + b.exVat), net: r2(a.net + b.net), moneyOut: r2(a.moneyOut + b.moneyOut), out,
      variance: a.variance == null && b.variance == null ? null : r2((a.variance ?? 0) + (b.variance ?? 0)),
      till: r2(a.till + b.till), catering: r2(a.catering + b.catering), platforms,
      card: r2(a.card + b.card), cash: r2(a.cash + b.cash), bankIn: r2(a.bankIn + b.bankIn), tips: r2(a.tips + b.tips),
      hours: r2(a.hours + b.hours),
    };
  }, { ...day }));
}

export function mergeDashboardCards(list: DashboardCards[]): DashboardCards {
  const [first] = list;
  return {
    ...first,
    cur: { ...first.cur, days: mergeCardDays(list.map((c) => c.cur.days)) },
    prev: { ...first.prev, days: mergeCardDays(list.map((c) => c.prev.days)) },
  };
}
