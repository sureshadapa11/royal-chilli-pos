import supabase from "@/lib/supabase";
import { tradingDayStr } from "@/lib/london-date";
import { PLATFORMS } from "@/lib/platforms";
import { chunked, getPnl, getSalesData, labourCostByDay, r2 } from "@/lib/finance";
import { savedDays, summarise, type DailySummary } from "@/lib/daily-accounts";
import { getDashboardCards, mergeDashboardCards, type DashboardCards } from "@/lib/dashboard-cards";

// Admin dashboard figures (Staff Hub home, admin only). Revenue = our own paid
// orders (till, QR, website) after discounts, VAT included, minus refunds on
// the day they were given, plus delivery-platform gross sales from Daily
// Accounts. The summary is the Finance P&L (lib/finance.ts
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
export type AdminSummary = {
  range: RangeKey;
  from: string;
  to: string;
  totalSales: number;
  exVat: number;
  costs: { ingredients: number; staff: number; expenses: number; expenseLines: { key: string; label: string; amount: number }[]; commission: number; cardFees: number; paidOut: number; total: number };
  profit: number;
};

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
  dailyAccounts: DailySummary;
  summary: AdminSummary;
  /** Cards from Daily accounts, Expenses and Attendance (work without the till). */
  cards: DashboardCards;
  /** Real till orders in the last two weeks: show the till-only cards (by hour, channels, dishes, spend). */
  hasTill: boolean;
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

function summaryFromPnl(range: RangeKey, pnl: Awaited<ReturnType<typeof getPnl>>): AdminSummary {
  return {
    range, from: pnl.from, to: pnl.to,
    totalSales: pnl.sales.total,
    exVat: pnl.sales.ex_vat,
    costs: {
      ingredients: pnl.costs.ingredients,
      staff: pnl.costs.staff,
      expenses: pnl.costs.expenses,
      expenseLines: pnl.costs.expense_lines,
      commission: pnl.costs.commission,
      cardFees: pnl.costs.card_fees,
      paidOut: pnl.costs.paid_out,
      total: pnl.costs.total,
    },
    profit: pnl.profit,
  };
}

export async function getAdminSummary(businessId: number, range: RangeKey): Promise<AdminSummary> {
  const dates = rangeDates(range, tradingDayStr());
  return summaryFromPnl(range, await getPnl(businessId, dates.from, dates.to));
}

export function mergeAdminSummaries(list: AdminSummary[]): AdminSummary {
  const [first, ...rest] = list;
  const sum = (pick: (s: AdminSummary) => number) => list.reduce((total, s) => r2(total + pick(s)), 0);
  return {
    range: first.range, from: first.from, to: first.to,
    totalSales: sum((s) => s.totalSales),
    exVat: sum((s) => s.exVat),
    costs: {
      ingredients: sum((s) => s.costs.ingredients),
      staff: sum((s) => s.costs.staff),
      expenses: sum((s) => s.costs.expenses),
      expenseLines: first.costs.expenseLines.map((line) => ({
        ...line,
        amount: rest.reduce((total, s) => r2(total + (s.costs.expenseLines.find((x) => x.key === line.key)?.amount ?? 0)), line.amount),
      })),
      commission: sum((s) => s.costs.commission),
      cardFees: sum((s) => s.costs.cardFees),
      paidOut: sum((s) => s.costs.paidOut),
      total: sum((s) => s.costs.total),
    },
    profit: sum((s) => s.profit),
  };
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
  const weekRange = rangeDates("this_week", today);

  // One fetch covering last week → this week.
  const [sales14, costByDay, summary, dailyRows, cards] = await Promise.all([
    getSalesData(businessId, lastMon, sun),
    labourCostByDay(businessId, mon, sun),
    getAdminSummary(businessId, range),
    savedDays(businessId, weekRange.from, weekRange.to),
    getDashboardCards(businessId, range, rangeDates(range, today), today),
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
    dailyAccounts: summarise(dailyRows, weekRange.from, weekRange.to, today),
    summary: {
      ...summary,
    },
    cards,
    hasTill: sales14.orders.length > 0,
  };
}

// ── Owner: every business combined ("Working in: All businesses") ────────────

const add = (a: number, b: number) => r2(a + b);

/**
 * Several businesses' dashboards as one: every figure added up, comparisons
 * worked out again from the totals (not averaged), and top dishes from all of
 * them, each labelled with its business. Pure.
 */
export function mergeDashboards(list: { name: string; data: AdminDashboard }[]): AdminDashboard {
  if (list.length === 1) return list[0].data;
  const [first, ...rest] = list.map((l) => l.data);
  const today = first.today;

  const byIndex = <T,>(pick: (d: AdminDashboard) => T[], sum: (a: T, b: T) => T) =>
    pick(first).map((row, i) => rest.reduce((acc, d) => sum(acc, pick(d)[i] ?? acc), row));
  const byKey = <T extends { key: string }>(pick: (d: AdminDashboard) => T[], sum: (a: T, b: T) => T): T[] => {
    const out = new Map<string, T>();
    for (const d of [first, ...rest]) for (const row of pick(d)) out.set(row.key, out.has(row.key) ? sum(out.get(row.key)!, row) : { ...row });
    return [...out.values()];
  };

  const week = byIndex((d) => d.week, (a, b) => ({ ...a, revenue: add(a.revenue, b.revenue), lastWeek: add(a.lastWeek, b.lastWeek), staffCost: add(a.staffCost, b.staffCost) }));
  const todayRevenue = list.reduce((s, l) => add(s, l.data.todayRevenue), 0);
  const daysSoFar = week.filter((d) => d.date <= today);
  const sm = list.map((l) => l.data.summary);

  return {
    today,
    todayRevenue,
    todayVsLastWeekPct: pct(todayRevenue, week.find((d) => d.date === today)?.lastWeek ?? 0),
    todayHourly: byIndex((d) => d.todayHourly, (a, b) => ({ ...a, revenue: add(a.revenue, b.revenue) })),
    week,
    weekRevenue: list.reduce((s, l) => add(s, l.data.weekRevenue), 0),
    weekVsLastWeekPct: pct(daysSoFar.reduce((s, d) => s + d.revenue, 0), daysSoFar.reduce((s, d) => s + d.lastWeek, 0)),
    channels: byKey((d) => d.channels, (a, b) => ({ ...a, revenue: add(a.revenue, b.revenue), orders: a.orders + b.orders })),
    topDishes: list
      .flatMap((l) => l.data.topDishes.map((t) => ({ ...t, name: `${t.name} · ${l.name}` })))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    dailyAccounts: {
      bankIn: list.reduce((s, l) => add(s, l.data.dailyAccounts.bankIn), 0),
      cash: list.reduce((s, l) => add(s, l.data.dailyAccounts.cash), 0),
      notBanked: list.reduce((s, l) => add(s, l.data.dailyAccounts.notBanked), 0),
      pending: list.reduce((s, l) => add(s, l.data.dailyAccounts.pending), 0),
      cateringPaid: list.reduce((s, l) => add(s, l.data.dailyAccounts.cateringPaid), 0),
      cateringPending: list.reduce((s, l) => add(s, l.data.dailyAccounts.cateringPending), 0),
      opening: null,
      closing: null,
      submitted: list.reduce((s, l) => s + l.data.dailyAccounts.submitted, 0),
      daysSoFar: list.reduce((s, l) => s + l.data.dailyAccounts.daysSoFar, 0),
      missing: [],
    },
    summary: mergeAdminSummaries(sm),
    cards: mergeDashboardCards(list.map((l) => l.data.cards)),
    hasTill: list.some((l) => l.data.hasTill),
  };
}
