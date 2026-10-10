import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { allRows, getVatRate, labourCostByDay, r2 } from "@/lib/finance";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";
import { savedDays, type DailyRow } from "@/lib/daily-accounts";

// Day by day: what came in, everything that went out, and what's left — the
// owner's own sums, used by the Daily accounts month sheet (screen + Excel)
// and the All businesses table, so the two always agree:
//   • Total sales = Z report + Just Eat + Deliveroo + Uber Eats + Hiest + catering paid
//     (platform sales are their full sales, commission included)
//   • Ex-VAT      = Total sales ÷ (1 + VAT rate), i.e. ÷ 1.2
//   • Money out   = stock received + expenses (full amount) + card fee
//                   + cash paid out of the till + staff wages + platform commission
//   • Net total   = Ex-VAT − Money out
//   • Variance    = opening balance − closing balance
// Figures come from the Daily accounts sheet. A day with no Z report or card
// figure on its sheet uses the till's own takings, so it never counts as £0.
// Unlike Finance → Profit & Loss, nothing takes VAT back off the costs.
// Supplier payments aren't counted: they pay for the stock deliveries already in.

export const DEFAULT_CARD_FEE_RATE = 0.0169; // SumUp

export type MoneyOut = { stock: number; expenses: number; card_fee: number; paid_out: number; wages: number; commission: number };
export const MONEY_OUT_PARTS: { key: keyof MoneyOut; label: string }[] = [
  { key: "stock", label: "Stock received" },
  { key: "expenses", label: "Expenses" },
  { key: "card_fee", label: "Card fee" },
  { key: "paid_out", label: "Till paid out" },
  { key: "wages", label: "Staff wages" },
  { key: "commission", label: "Commission" },
];

export type DayInputs = {
  z_report: number; card: number; commission: number; catering_paid: number;
  just_eat: number; deliveroo: number; uber_eats: number; hiest: number;
  opening: number | null; closing: number | null;
  stock: number; expenses: number; paid_out: number; wages: number;
};

export type DayFigures = {
  date: string;
  total_sales: number;
  ex_vat: number;
  money_out: number;
  net_total: number;
  variance: number | null;
  out: MoneyOut;
  till_fallback: boolean; // Z report / card taken from the till, not the sheet
};

export type FiguresTotal = Omit<DayFigures, "date" | "till_fallback">;

/** One day's sums (pure, so it can be tested). */
export function dayFigures(date: string, i: DayInputs, vatRate: number, cardFeeRate: number, tillFallback = false): DayFigures {
  const total = r2(i.z_report + i.just_eat + i.deliveroo + i.uber_eats + i.hiest + i.catering_paid);
  const exVat = r2(total / (1 + vatRate));
  const out: MoneyOut = {
    stock: r2(i.stock), expenses: r2(i.expenses), card_fee: r2(i.card * cardFeeRate),
    paid_out: r2(i.paid_out), wages: r2(i.wages), commission: r2(i.commission),
  };
  const moneyOut = r2(Object.values(out).reduce((s, n) => s + n, 0));
  return {
    date, total_sales: total, ex_vat: exVat, money_out: moneyOut, net_total: r2(exVat - moneyOut),
    variance: i.opening != null && i.closing != null ? r2(i.opening - i.closing) : null,
    out, till_fallback: tillFallback,
  };
}

/** Every column added up (variance: the days that have one). */
export function totalFigures(days: DayFigures[]): FiguresTotal {
  const sum = (f: (d: DayFigures) => number) => r2(days.reduce((s, d) => s + f(d), 0));
  const withVariance = days.filter((d) => d.variance != null);
  return {
    total_sales: sum((d) => d.total_sales), ex_vat: sum((d) => d.ex_vat),
    money_out: sum((d) => d.money_out), net_total: sum((d) => d.net_total),
    variance: withVariance.length ? sum((d) => d.variance ?? 0) : null,
    out: Object.fromEntries(MONEY_OUT_PARTS.map(({ key }) => [key, sum((d) => d.out[key])])) as MoneyOut,
  };
}

export async function getCardFeeRate(businessId: number): Promise<number> {
  const { data, error } = await supabase.from("businesses").select("card_fee_rate").eq("id", businessId).maybeSingle();
  // Before migration 123 the column doesn't exist — use SumUp's rate.
  if (error || data?.card_fee_rate == null) return DEFAULT_CARD_FEE_RATE;
  return Number(data.card_fee_rate);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; ) {
    out.push(d);
    const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10);
  }
  return out;
}

const add = (m: Map<string, number>, day: string, n: number) => m.set(day, (m.get(day) ?? 0) + n);
const dayOf = (iso: string) => tradingDayStr(new Date(iso));

/** The till's own takings and card per trading day — for days with no sheet figure. */
async function tillByDay(businessId: number, from: string, to: string) {
  const { start, end } = tradingRangeUtc(from, to);
  const db = bizDb(businessId);
  const [orders, payments] = await Promise.all([
    allRows<{ total: number; created_at: string }>((a, b) =>
      db.from("orders").select("total, created_at").eq("is_paid", true)
        .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    allRows<{ amount: number; tip_amount: number | null; method: string; created_at: string }>((a, b) =>
      db.from("payments").select("amount, tip_amount, method, created_at")
        .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
  ]);
  const sales = new Map<string, number>();
  const card = new Map<string, number>();
  for (const o of orders) add(sales, dayOf(o.created_at), Number(o.total));
  for (const p of payments) {
    const amount = Number(p.amount);
    if (amount < 0) add(sales, dayOf(p.created_at), amount); // refund
    else if (p.method === "card" || p.method === "card_online") add(card, dayOf(p.created_at), amount + Number(p.tip_amount || 0));
  }
  return { sales, card };
}

/** Stock, expenses and till paid-outs per day (wages and commission come separately). */
async function costsByDay(businessId: number, from: string, to: string) {
  const db = bizDb(businessId);
  const { start, end } = tradingRangeUtc(from, to);
  const [pos, expenses, periods] = await Promise.all([
    allRows<{ total_cost: number; received_date: string }>((a, b) =>
      db.from("purchase_orders").select("total_cost, received_date").eq("status", "received")
        .gte("received_date", from).lte("received_date", to).order("id").range(a, b)),
    allRows<{ amount: number; expense_date: string }>((a, b) =>
      db.from("expenses").select("amount, expense_date")
        .gte("expense_date", from).lte("expense_date", to).order("id").range(a, b)),
    allRows<{ id: number; opened_at: string }>((a, b) =>
      db.from("work_periods").select("id, opened_at").gte("opened_at", start).lte("opened_at", end).order("id").range(a, b)),
  ]);
  // Till paid-outs count on the trading day their shift opened, like the Z report.
  const shiftDay = new Map(periods.map((p) => [p.id, dayOf(p.opened_at)]));
  const paidOuts = periods.length
    ? await allRows<{ amount: number; work_period_id: number }>((a, b) =>
        db.from("cash_paid_outs").select("amount, work_period_id").in("work_period_id", [...shiftDay.keys()]).order("id").range(a, b))
    : [];

  const stock = new Map<string, number>();
  const spent = new Map<string, number>();
  const paidOut = new Map<string, number>();
  for (const po of pos) add(stock, po.received_date, Number(po.total_cost));
  for (const e of expenses) add(spent, e.expense_date, Number(e.amount));
  for (const p of paidOuts) add(paidOut, shiftDay.get(p.work_period_id)!, Number(p.amount));
  return { stock, spent, paidOut };
}

/** Every day from..to with its sums, plus the sheet rows they came from. */
export async function accountsByDay(businessId: number, from: string, to: string): Promise<{ days: DayFigures[]; rows: DailyRow[] }> {
  const [rows, vatRate, cardFeeRate, till, costs, wages] = await Promise.all([
    savedDays(businessId, from, to),
    getVatRate(businessId),
    getCardFeeRate(businessId),
    tillByDay(businessId, from, to),
    costsByDay(businessId, from, to),
    labourCostByDay(businessId, from, to),
  ]);
  const byDate = new Map(rows.map((r) => [r.trading_date, r]));
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

  const days = daysBetween(from, to).map((d) => {
    const r = byDate.get(d);
    const z = num(r?.z_report);
    const card = num(r?.card);
    return dayFigures(d, {
      z_report: z ?? r2(till.sales.get(d) ?? 0),
      card: card ?? r2(till.card.get(d) ?? 0),
      commission: num(r?.commission) ?? 0,
      catering_paid: num(r?.catering_paid) ?? 0,
      just_eat: num(r?.just_eat) ?? 0, deliveroo: num(r?.deliveroo) ?? 0,
      uber_eats: num(r?.uber_eats) ?? 0, hiest: num(r?.hiest) ?? 0,
      opening: num(r?.opening_balance), closing: num(r?.closing_balance),
      stock: costs.stock.get(d) ?? 0, expenses: costs.spent.get(d) ?? 0,
      paid_out: costs.paidOut.get(d) ?? 0, wages: wages.get(d) ?? 0,
    }, vatRate, cardFeeRate, (z == null && till.sales.has(d)) || (card == null && till.card.has(d)));
  });
  return { days, rows };
}
