import { mergeDashboards, type AdminDashboard } from "@/lib/admin-dashboard";
import type { CardDay } from "@/lib/dashboard-cards";

const cardDay = (total: number, jeCommission: number, variance: number | null, sheet: boolean): CardDay => ({
  date: "2026-10-03", sheet, tillOnly: false, total, exVat: total / 1.2, net: total / 2, moneyOut: total / 2,
  out: { stock: 1, expenses: 2, card_fee: 0, paid_out: 0, wages: 3, commission: jeCommission },
  variance, till: total, catering: 0,
  platforms: { just_eat: { sales: 10, commission: jeCommission }, deliveroo: { sales: 0, commission: 0 }, uber_eats: { sales: 0, commission: 0 }, hiest: { sales: 0, commission: 0 } },
  card: 60, cash: 40, bankIn: 30, tips: 2, hours: 8,
});

const dash = (o: { today: number; week: [number, number][]; dish: [string, number]; channel: number; staff: number; profit: number; rent: number; bank: number; submitted: number }): AdminDashboard => ({
  today: "2026-10-03",
  todayRevenue: o.today,
  todayVsLastWeekPct: null,
  todayHourly: [{ hour: "12:00", revenue: o.today }],
  week: o.week.map(([rev, last], i) => ({ date: `2026-10-0${i + 2}`, label: "x", revenue: rev, lastWeek: last, staffCost: o.staff })),
  weekRevenue: o.week.reduce((s, [r]) => s + r, 0),
  weekVsLastWeekPct: null,
  channels: [{ key: "dine_in", label: "Dine-in", platform: false, revenue: o.channel, orders: 2 }],
  topDishes: [{ name: o.dish[0], revenue: o.dish[1], qty: 1 }],
  dailyAccounts: {
    bankIn: o.bank, cash: 50, notBanked: 20, pending: 5, cateringPaid: 15, cateringPending: 8,
    opening: null, closing: null, submitted: o.submitted, daysSoFar: 7, missing: [],
  },
  summary: {
    range: "this_week", from: "2026-09-28", to: "2026-10-04", totalSales: 100, exVat: 80,
    costs: { ingredients: 5, staff: o.staff, expenses: o.rent, expenseLines: [{ key: "rent", label: "Rent", amount: o.rent }], commission: 2, cardFees: 1, paidOut: 0, total: 10 },
    profit: o.profit,
  },
  cards: {
    range: "this_week", today: "2026-10-03",
    cur: { from: "2026-10-03", to: "2026-10-03", days: [cardDay(o.today, o.staff / 10, o.bank > 20 ? 5 : null, o.bank > 20)] },
    prev: { from: "2026-09-26", to: "2026-09-26", days: [cardDay(0, 0, null, false)] },
  },
  hasTill: o.bank > 20,
});

describe("owner's All businesses dashboard", () => {
  const rc = dash({ today: 120, week: [[100, 80], [120, 100], [0, 50]], dish: ["Chicken Biryani", 90], channel: 200, staff: 10, profit: 70, rent: 20, bank: 30, submitted: 5 });
  const mh = dash({ today: 30, week: [[50, 20], [30, 50], [0, 10]], dish: ["Cheese Melt", 40], channel: 80, staff: 5, profit: 20, rent: 0, bank: 10, submitted: 2 });
  const m = mergeDashboards([{ name: "Royal Chilli", data: rc }, { name: "Melt House", data: mh }]);

  it("adds the hand-entered cards day by day", () => {
    const d = m.cards.cur.days[0];
    expect(d.total).toBe(150);
    expect(d.platforms.just_eat).toEqual({ sales: 20, commission: 1.5 });
    expect(d.variance).toBe(5);
    expect(d.hours).toBe(16);
    expect(d.sheet).toBe(true);
    expect(m.hasTill).toBe(true);
  });

  it("adds up every figure", () => {
    expect(m.todayRevenue).toBe(150);
    expect(m.week.map((d) => d.revenue)).toEqual([150, 150, 0]);
    expect(m.channels).toEqual([expect.objectContaining({ key: "dine_in", revenue: 280, orders: 4 })]);
    expect(m.dailyAccounts).toMatchObject({ bankIn: 40, cash: 100, notBanked: 40, submitted: 7, daysSoFar: 14 });
    expect(m.summary.profit).toBe(90);
    expect(m.summary.costs.expenseLines).toEqual([{ key: "rent", label: "Rent", amount: 20 }]);
  });

  it("works comparisons out again from the totals, not by averaging", () => {
    // today (3 Oct): 150 vs same day last week 100 + 50 = 150 → 0%
    expect(m.todayVsLastWeekPct).toBe(0);
    // week so far (2–3 Oct): 300 vs last week 80 + 100 + 20 + 50 = 250 → +20%
    expect(m.weekVsLastWeekPct).toBe(20);
  });

  it("lists top dishes from every business, labelled with the business", () => {
    expect(m.topDishes.map((d) => d.name)).toEqual(["Chicken Biryani · Royal Chilli", "Cheese Melt · Melt House"]);
  });

  it("one business is just that business", () => {
    expect(mergeDashboards([{ name: "Royal Chilli", data: rc }])).toBe(rc);
  });
});
