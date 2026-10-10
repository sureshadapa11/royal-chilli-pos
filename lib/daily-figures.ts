import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { allRows, extractVat, getVatRate, labourCostByDay, r2 } from "@/lib/finance";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";
import { savedDays, type DailyRow } from "@/lib/daily-accounts";

// Day by day: what came in, everything that went out, and what's left. One set
// of sums (accountant rules) behind Finance → Profit & Loss, the dashboard's
// Summary card, the All businesses table and the Daily accounts month sheet,
// so every screen shows the same figures:
//   • Sales     = Z report net sales (tips not included) + Just Eat + Deliveroo
//                 + Uber Eats + Hiest + catering paid
//   • Ex-VAT    = Sales ÷ (1 + VAT rate), i.e. ÷ 1.2
//   • Money out = stock received + expenses (VAT claimed back taken off) + card fee
//                 + cash paid out of the till + staff wages + platform commission
//   • Net total = Ex-VAT − Money out (the profit)
//   • Variance  = opening balance − closing balance
// Figures come from the Daily accounts sheet. A day with no Z report or card
// figure on its sheet uses the till's own payments, so it never counts as £0.
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

export type SalesParts = { till: number; platforms: number; catering: number };

export type DayInputs = {
  z_report: number; card: number; commission: number; catering_paid: number;
  just_eat: number; deliveroo: number; uber_eats: number; hiest: number;
  opening: number | null; closing: number | null;
  stock: number; expenses: number; paid_out: number; wages: number; // expenses already ex reclaimable VAT
};

export type DayFigures = {
  date: string;
  total_sales: number;
  ex_vat: number;
  money_out: number;
  net_total: number;
  variance: number | null;
  sales: SalesParts;
  out: MoneyOut;
  till_fallback: boolean; // Z report / card taken from the till, not the sheet
};

export type FiguresTotal = Omit<DayFigures, "date" | "till_fallback">;

/** One day's sums (pure, so it can be tested). */
export function dayFigures(date: string, i: DayInputs, vatRate: number, cardFeeRate: number, tillFallback = false): DayFigures {
  const sales: SalesParts = {
    till: r2(i.z_report),
    platforms: r2(i.just_eat + i.deliveroo + i.uber_eats + i.hiest),
    catering: r2(i.catering_paid),
  };
  const total = r2(sales.till + sales.platforms + sales.catering);
  const exVat = r2(total / (1 + vatRate));
  const out: MoneyOut = {
    stock: r2(i.stock), expenses: r2(i.expenses), card_fee: r2(i.card * cardFeeRate),
    paid_out: r2(i.paid_out), wages: r2(i.wages), commission: r2(i.commission),
  };
  const moneyOut = r2(Object.values(out).reduce((s, n) => s + n, 0));
  return {
    date, total_sales: total, ex_vat: exVat, money_out: moneyOut, net_total: r2(exVat - moneyOut),
    variance: i.opening != null && i.closing != null ? r2(i.opening - i.closing) : null,
    sales, out, till_fallback: tillFallback,
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
    sales: { till: sum((d) => d.sales.till), platforms: sum((d) => d.sales.platforms), catering: sum((d) => d.sales.catering) },
    out: Object.fromEntries(MONEY_OUT_PARTS.map(({ key }) => [key, sum((d) => d.out[key])])) as MoneyOut,
  };
}

export async function getCardFeeRate(businessId: number): Promise<number> {
  const { data, error } = await supabase.from("businesses").select("card_fee_rate").eq("id", businessId).maybeSingle();
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

/**
 * The till's own takings per trading day, worked out like the Z report: money
 * received (tips not included) minus refunds, and card taken (tips included,
 * as the card fee is charged on it). A refund is taken off once, whatever
 * happened to its order. For days with no sheet figure.
 */
async function tillByDay(businessId: number, from: string, to: string) {
  const { start, end } = tradingRangeUtc(from, to);
  const payments = await allRows<{ amount: number; tip_amount: number | null; method: string; created_at: string }>((a, b) =>
    bizDb(businessId).from("payments").select("amount, tip_amount, method, created_at")
      .gte("created_at", start).lte("created_at", end).order("id").range(a, b));
  const sales = new Map<string, number>();
  const card = new Map<string, number>();
  for (const p of payments) {
    const day = dayOf(p.created_at);
    const amount = Number(p.amount);
    add(sales, day, amount); // a refund is negative
    if (amount > 0 && (p.method === "card" || p.method === "card_online")) add(card, day, amount + Number(p.tip_amount || 0));
  }
  return { sales, card };
}

/** Stock, expenses (ex reclaimable VAT) and till paid-outs per day. */
async function costsByDay(businessId: number, from: string, to: string, vatRate: number) {
  const db = bizDb(businessId);
  const { start, end } = tradingRangeUtc(from, to);
  const [pos, expenses, periods] = await Promise.all([
    allRows<{ total_cost: number; received_date: string }>((a, b) =>
      db.from("purchase_orders").select("total_cost, received_date").eq("status", "received")
        .gte("received_date", from).lte("received_date", to).order("id").range(a, b)),
    allRows<{ amount: number; vat_applicable: number | boolean; expense_date: string }>((a, b) =>
      db.from("expenses").select("amount, vat_applicable, expense_date")
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
  for (const e of expenses) {
    const amount = Number(e.amount);
    add(spent, e.expense_date, e.vat_applicable ? amount - extractVat(amount, vatRate) : amount);
  }
  for (const p of paidOuts) add(paidOut, shiftDay.get(p.work_period_id)!, Number(p.amount));
  return { stock, spent, paidOut };
}

/** Every day from..to with its sums, plus the sheet rows they came from. */
export async function accountsByDay(businessId: number, from: string, to: string): Promise<{ days: DayFigures[]; rows: DailyRow[]; vatRate: number }> {
  const [rows, vatRate, cardFeeRate, till, wages] = await Promise.all([
    savedDays(businessId, from, to),
    getVatRate(businessId),
    getCardFeeRate(businessId),
    tillByDay(businessId, from, to),
    labourCostByDay(businessId, from, to),
  ]);
  const costs = await costsByDay(businessId, from, to, vatRate);
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
  return { days, rows, vatRate };
}
