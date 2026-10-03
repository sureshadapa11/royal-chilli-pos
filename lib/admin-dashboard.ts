import supabase from "@/lib/supabase";
import { tradingDayStr } from "@/lib/london-date";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { chunked, getPnl, getSalesData, labourCostByDay, r2 } from "@/lib/finance";
import { bizDb } from "@/lib/business-db";

// Admin dashboard figures (Staff Hub home, admin only). Revenue = our own paid
// orders (till, QR, website) after discounts, VAT included, minus refunds on
// the day they were given, plus the delivery platforms' gross sales typed in
// daily (platform_sales). The summary is the Finance P&L (lib/finance.ts
// getPnl) for the chosen range, so the two screens always agree. Weeks run
// Monday–Sunday; days are trading days (5am–5am UK).

export const RANGES = {
  today: "Today",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
} as const;
export type RangeKey = keyof typeof RANGES;

export type Channel = { key: string; label: string; platform: boolean; revenue: number; orders: number };
export type PlatformRow = { key: PlatformKey; label: string; orders: number; sales: number; commission: number; keep: number };

export type AdminDashboard = {
  today: string;
  todayRevenue: number;
  todayVsLastWeekPct: number | null;
  todayHourly: { hour: string; revenue: number }[];
  week: { date: string; label: string; revenue: number; lastWeek: number; staffCost: number }[];
  weekRevenue: number;
  weekVsLastWeekPct: number | null;
  channels: Channel[];
  topDishes: { name: string; revenue: number; qty: number }[];
  platforms: PlatformRow[];
  platformsMissingYesterday: boolean;
  summary: {
    range: RangeKey;
    from: string;
    to: string;
    totalSales: number;
    exVat: number;
    costs: { ingredients: number; staff: number; expenses: number; expenseLines: { key: string; label: string; amount: number }[]; commission: number; cardFees: number; total: number };
    profit: number;
  };
};


export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(dateStr: string): string {
  const wd = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0 = Sun
  return addDays(dateStr, -((wd + 6) % 7));
}

export function rangeDates(range: RangeKey, today: string): { from: string; to: string } {
  const mon = mondayOf(today);
  switch (range) {
    case "today": return { from: today, to: today };
    case "this_week": return { from: mon, to: addDays(mon, 6) };
    case "last_week": return { from: addDays(mon, -7), to: addDays(mon, -1) };
    case "this_month": {
      const first = today.slice(0, 8) + "01";
      const next = new Date(first + "T00:00:00Z");
      next.setUTCMonth(next.getUTCMonth() + 1);
      return { from: first, to: addDays(next.toISOString().slice(0, 10), -1) };
    }
    case "last_month": {
      const first = new Date(today.slice(0, 8) + "01T00:00:00Z");
      first.setUTCMonth(first.getUTCMonth() - 1);
      const from = first.toISOString().slice(0, 10);
      return { from, to: addDays(today.slice(0, 8) + "01", -1) };
    }
  }
}

const dayOf = (o: { created_at: string }) => tradingDayStr(new Date(o.created_at));
const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short" });

const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

const OWN_CHANNELS: { key: string; label: string }[] = [
  { key: "dine_in", label: "Dine-in" },
  { key: "takeaway", label: "Collection" },
  { key: "delivery", label: "Website delivery" },
];

export async function getAdminDashboard(businessId: number, range: RangeKey): Promise<AdminDashboard> {
  const today = tradingDayStr();
  const mon = mondayOf(today);
  const sun = addDays(mon, 6);
  const lastMon = addDays(mon, -7);
  const sum = rangeDates(range, today);
  const yesterday = addDays(today, -1);

  // One fetch covering last week → this week.
  const [sales14, costByDay, summary] = await Promise.all([
    getSalesData(businessId, lastMon, sun),
    labourCostByDay(businessId, mon, sun),
    getPnl(businessId, sum.from, sum.to),
  ]);
  const plat14 = sales14.platforms;

  // Own sales per trading day: orders on the day they were placed, refunds on
  // the day they were given (same rule as the P&L).
  const ownByDay = new Map<string, number>();
  const add = (d: string, n: number) => ownByDay.set(d, (ownByDay.get(d) ?? 0) + n);
  for (const o of sales14.orders) add(dayOf(o), o.total);
  for (const r of sales14.refunds) add(dayOf(r), -r.amount);
  const platByDay = new Map<string, number>();
  for (const p of plat14) platByDay.set(p.sales_date, (platByDay.get(p.sales_date) ?? 0) + p.sales);
  const dayRevenue = (d: string) => r2((ownByDay.get(d) ?? 0) + (platByDay.get(d) ?? 0));

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(mon, i);
    return { date, label: dayLabel(date), revenue: dayRevenue(date), lastWeek: dayRevenue(addDays(date, -7)), staffCost: r2(costByDay.get(date) ?? 0) };
  });
  const weekRevenue = r2(week.reduce((s, d) => s + d.revenue, 0));
  // Compare like with like: last week up to the same weekday.
  const daysSoFar = week.filter((d) => d.date <= today);
  const lastWeekSoFar = daysSoFar.reduce((s, d) => s + d.lastWeek, 0);

  // Today by hour (UK clock), 11:00 → 04:00 with the trading day's small hours at the end.
  const hourly = new Map<number, number>();
  const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false });
  const addHour = (iso: string, n: number) => {
    const h = Number(hourFmt.format(new Date(iso))) % 24;
    hourly.set(h, (hourly.get(h) ?? 0) + n);
  };
  for (const o of sales14.orders) if (dayOf(o) === today) addHour(o.created_at, o.total);
  for (const r of sales14.refunds) if (dayOf(r) === today) addHour(r.created_at, -r.amount);
  const hours = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  for (const h of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) if (hourly.has(h)) (h < 5 ? hours.push(h) : hours.unshift(h));
  hours.sort((a, b) => ((a + 19) % 24) - ((b + 19) % 24)); // 5am first
  const todayHourly = hours.map((h) => ({ hour: `${String(h).padStart(2, "0")}:00`, revenue: r2(hourly.get(h) ?? 0) }));

  // Channels, this week.
  const weekOrders = sales14.orders.filter((o) => dayOf(o) >= mon);
  const weekRefunds = sales14.refunds.filter((r) => dayOf(r) >= mon);
  const weekPlat = plat14.filter((p) => p.sales_date >= mon);
  const channels: Channel[] = [
    ...OWN_CHANNELS.map((c) => {
      const os = weekOrders.filter((o) => o.order_type === c.key);
      const refunded = weekRefunds.filter((r) => r.order_type === c.key).reduce((s, r) => s + r.amount, 0);
      return { key: c.key, label: c.label, platform: false, revenue: r2(os.reduce((s, o) => s + o.total, 0) - refunded), orders: os.length };
    }),
    ...PLATFORMS.map((p) => {
      const rows = weekPlat.filter((r) => r.platform === p.key);
      return { key: p.key, label: p.label, platform: true, revenue: r2(rows.reduce((s, r) => s + r.sales, 0)), orders: rows.reduce((s, r) => s + r.orders, 0) };
    }),
  ];

  const platforms: PlatformRow[] = PLATFORMS.map((p) => {
    const rows = weekPlat.filter((r) => r.platform === p.key);
    const sales = r2(rows.reduce((s, r) => s + r.sales, 0));
    const commission = r2(rows.reduce((s, r) => s + r.commission, 0));
    return { key: p.key, label: p.label, orders: rows.reduce((s, r) => s + r.orders, 0), sales, commission, keep: r2(sales - commission) };
  });

  // Top dishes by revenue, this week (own orders only — platforms aren't itemised).
  const items = await chunked(weekOrders.map((o) => o.id), async (ids) => {
    const { data, error } = await supabase.from("order_items").select("order_id, item_name, item_price, quantity")
      .in("order_id", ids).neq("status", "cancelled");
    if (error) throw error;
    return data ?? [];
  });
  const dish = new Map<string, { revenue: number; qty: number }>();
  for (const i of items) {
    const cur = dish.get(i.item_name) ?? { revenue: 0, qty: 0 };
    cur.revenue += Number(i.item_price) * Number(i.quantity);
    cur.qty += Number(i.quantity);
    dish.set(i.item_name, cur);
  }
  const topDishes = [...dish.entries()]
    .map(([name, v]) => ({ name, revenue: r2(v.revenue), qty: v.qty }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const { count: yCount, error: yErr } = await bizDb(businessId).from("platform_sales").select("id", { count: "exact", head: true })
    .eq("sales_date", yesterday);

  return {
    today,
    todayRevenue: dayRevenue(today),
    todayVsLastWeekPct: pct(dayRevenue(today), dayRevenue(addDays(today, -7))),
    todayHourly,
    week,
    weekRevenue,
    weekVsLastWeekPct: pct(daysSoFar.reduce((s, d) => s + d.revenue, 0), lastWeekSoFar),
    channels,
    topDishes,
    platforms,
    platformsMissingYesterday: !yErr && (yCount ?? 0) === 0,
    summary: {
      range, from: sum.from, to: sum.to, totalSales: summary.sales.total, exVat: summary.sales.ex_vat,
      costs: {
        ingredients: summary.costs.ingredients, staff: summary.costs.staff, expenses: summary.costs.expenses, expenseLines: summary.costs.expense_lines,
        commission: summary.costs.commission, cardFees: summary.costs.card_fees, total: summary.costs.total,
      },
      profit: summary.profit,
    },
  };
}
