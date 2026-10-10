import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { tradingRangeUtc } from "@/lib/london-date";
import type { PlatformKey } from "@/lib/platforms";
import { loadRecipeBook, recipeUsage } from "@/lib/recipes";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { accountsByDay, totalFigures, type FiguresTotal } from "@/lib/daily-figures";

// Money figures for one business (each is its own company, with its own P&L
// and VAT). Finance → Profit & Loss, Finance → VAT, the dashboard's Summary
// card, the All businesses table and the Daily accounts month sheet all come
// from the same day-by-day sums in lib/daily-figures.ts, so the same date range
// shows the same numbers on every screen. Accountant rules:
//   • Sales = Z report net sales (tips not included) + delivery platforms +
//     catering paid, from Daily accounts (the till's payments on a day with
//     no sheet figure). VAT is Sales ÷ 1.2.
//   • Costs = stock received + expenses (VAT claimed back taken off) + card
//     fee (Settings rate, 1.69%) + cash paid out of the till + staff wages
//     (hours × pay rate) + platform commission.
//   • Profit = Sales ex-VAT − Costs.
// getSalesData (bills by order date) is still used for the dashboard charts,
// recipe cost and stock usage.

export const r2 = (n: number) => Math.round(n * 100) / 100;

// The business's own VAT rate (Settings → Business setup → Tax & VAT).
export async function getVatRate(businessId: number): Promise<number> {
  const { data } = await supabase.from("businesses").select("vat_rate").eq("id", businessId).maybeSingle();
  return data?.vat_rate != null ? Number(data.vat_rate) : 0.2;
}

// For VAT-inclusive gross amounts: the VAT portion is gross * (rate / (1 + rate)).
export function extractVat(grossAmount: number, vatRate: number): number {
  return r2(grossAmount * (vatRate / (1 + vatRate)));
}

// Supabase caps a select at 1000 rows — page through so a busy month isn't cut short.
export async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// `.in()` with thousands of ids overflows the URL — ask in batches.
export async function chunked<T>(ids: number[], fetch: (ids: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 300) out.push(...(await fetch(ids.slice(i, i + 300))));
  return out;
}

// ── Sales ────────────────────────────────────────────────────────────────────
export type SaleOrder = { id: number; total: number; tax: number; order_type: string; created_at: string };
export type Refund = { order_id: number; amount: number; vat: number; order_type: string; created_at: string };
export type PlatformSaleRow = { sales_date: string; platform: PlatformKey; orders: number; sales: number; commission: number };
export type SalesData = { orders: SaleOrder[]; refunds: Refund[]; cardTaken: number; platforms: PlatformSaleRow[] };

export async function getSalesData(businessId: number, from: string, to: string): Promise<SalesData> {
  const { start, end } = tradingRangeUtc(from, to);
  const db = bizDb(businessId);
  const [orders, refundRows, cardRows, platforms] = await Promise.all([
    allRows<SaleOrder>((a, b) =>
      db.from("orders").select("id, total, tax, order_type, created_at").eq("is_paid", true)
        .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    allRows<{ order_id: number; amount: number; created_at: string; orders: unknown }>((a, b) =>
      db.from("payments").select("order_id, amount, created_at, orders(total, tax, order_type, is_paid)").lt("amount", 0)
        .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    allRows<{ amount: number; tip_amount: number | null }>((a, b) =>
      db.from("payments").select("amount, tip_amount").in("method", ["card", "card_online"]).gt("amount", 0)
        .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    getPlatformSales(businessId, from, to),
  ]);

  // A refund on an order that no longer counts as a sale (fully refunded, then
  // cancelled) is already out of sales — taking it off again would count it twice.
  const counted = refundRows.filter((p) => (p.orders as { is_paid?: boolean } | null)?.is_paid !== false);
  const refunds: Refund[] = counted.map((p) => {
    const o = p.orders as { total: number; tax: number; order_type: string } | null;
    const amount = -Number(p.amount);
    const total = Number(o?.total ?? 0);
    // A refund gives back the VAT in it too, in the same proportion as the bill.
    const vat = total > 0 ? amount * (Number(o?.tax ?? 0) / total) : 0;
    return { order_id: p.order_id, amount, vat, order_type: o?.order_type ?? "", created_at: p.created_at };
  });
  const cardTaken = cardRows.reduce((s, p) => s + Number(p.amount) + Number(p.tip_amount || 0), 0);

  return {
    orders: orders.map((o) => ({ ...o, total: Number(o.total), tax: Number(o.tax) })),
    refunds,
    cardTaken,
    platforms,
  };
}

export async function getPlatformSales(businessId: number, from: string, to: string): Promise<PlatformSaleRow[]> {
  const db = bizDb(businessId);
  const [{ data: accounts, error }, { data: legacyOrders }] = await Promise.all([
    db.from("daily_accounts").select("trading_date, just_eat, uber_eats, deliveroo, hiest, commission")
      .gte("trading_date", from).lte("trading_date", to),
    // Keep historical order counts for dashboard channel comparisons. Sales
    // and commission always come from Daily Accounts, the current source of truth.
    db.from("platform_sales").select("sales_date, platform, orders")
      .gte("sales_date", from).lte("sales_date", to),
  ]);
  if (error) { console.error("daily_accounts platform totals:", error.message); return []; }
  const orderCounts = new Map<string, number>();
  for (const row of legacyOrders ?? []) orderCounts.set(`${row.sales_date}:${row.platform}`, Number(row.orders) || 0);
  const out: PlatformSaleRow[] = [];
  for (const row of accounts ?? []) {
    const platforms: [PlatformKey, unknown][] = [
      ["just_eat", row.just_eat], ["uber_eats", row.uber_eats], ["deliveroo", row.deliveroo], ["hiest", row.hiest],
    ];
    let commissionAssigned = false;
    for (const [platform, rawSales] of platforms) {
      const sales = Number(rawSales ?? 0);
      const commission = !commissionAssigned ? Number(row.commission ?? 0) : 0;
      if (sales !== 0 || commission !== 0) {
        out.push({
          sales_date: row.trading_date,
          platform,
          orders: orderCounts.get(`${row.trading_date}:${platform}`) ?? 0,
          sales,
          commission,
        });
        commissionAssigned = true;
      }
    }
    // Commission may be entered even when platform sales have not yet been
    // split out. Keep it in the P&L once rather than losing or multiplying it.
    if (!commissionAssigned && Number(row.commission ?? 0) !== 0) {
      out.push({ sales_date: row.trading_date, platform: "just_eat", orders: 0, sales: 0, commission: Number(row.commission) });
    }
  }
  return out;
}

// ── Costs ────────────────────────────────────────────────────────────────────
export async function getIngredientPurchases(businessId: number, from: string, to: string): Promise<number> {
  const { data, error } = await bizDb(businessId)
    .from("purchase_orders")
    .select("total_cost")
    .eq("status", "received")
    .gte("received_date", from)
    .lte("received_date", to);
  if (error) throw error;
  return r2((data || []).reduce((s, po) => s + Number(po.total_cost), 0));
}

// Hours worked x current pay rate, computed live from clocked-out attendance —
// not a lookup into payroll_entries, which only has rows once a pay period has
// actually been run and would silently understate this (overstating profit)
// until then. Per work date, so the dashboard's daily bars and the P&L total
// come from the same numbers.
// Shifts worked at this business (staff are shared; each shift belongs to one).
export async function labourCostByDay(businessId: number, from: string, to: string): Promise<Map<string, number>> {
  const rows = await allRows<{ staff_id: number; work_date: string; net_work_seconds: number | null }>((a, b) =>
    bizDb(businessId).from("attendance").select("staff_id, work_date, net_work_seconds")
      .gte("work_date", from).lte("work_date", to).not("clock_out", "is", null).order("id").range(a, b));
  const ids = [...new Set(rows.map((r) => r.staff_id))];
  const { data: staff, error } = ids.length ? await supabase.from("staff").select("id, pay_rate").in("id", ids) : { data: [], error: null };
  if (error) throw error;
  const rate = new Map((staff ?? []).map((s) => [s.id, Number(s.pay_rate ?? 0)]));
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const cost = (Number(r.net_work_seconds ?? 0) / 3600) * (rate.get(r.staff_id) ?? 0);
    byDay.set(r.work_date, (byDay.get(r.work_date) ?? 0) + cost);
  }
  return byDay;
}

export async function getLabourCost(businessId: number, from: string, to: string): Promise<number> {
  const byDay = await labourCostByDay(businessId, from, to);
  return r2([...byDay.values()].reduce((s, n) => s + n, 0));
}

export type ExpenseTotals = { total: number; vatApplicableTotal: number };

export async function getOtherExpenses(
  businessId: number, from: string, to: string
): Promise<ExpenseTotals & { byCategory: Record<string, ExpenseTotals> }> {
  const data = await allRows<{ amount: number; vat_applicable: number; category: string }>((a, b) =>
    bizDb(businessId).from("expenses").select("amount, vat_applicable, category").gte("expense_date", from).lte("expense_date", to).order("id").range(a, b));
  const totals = (rows: typeof data): ExpenseTotals => ({
    total: r2(rows.reduce((s, e) => s + Number(e.amount), 0)),
    vatApplicableTotal: r2(rows.filter((e) => e.vat_applicable).reduce((s, e) => s + Number(e.amount), 0)),
  });
  const byCategory: Record<string, ExpenseTotals> = {};
  for (const c of new Set(data.map((e) => e.category))) byCategory[c] = totals(data.filter((e) => e.category === c));
  return { ...totals(data), byCategory };
}

// Real (accrual) cost of goods sold for our own orders: every item sold,
// costed at its recipe. Items with no recipe cost nothing here, so it comes
// with a coverage % (share of item sales that had a recipe).
export async function getRecipeCogs(businessId: number, orderIds: number[]): Promise<{ cogs: number; coveragePct: number }> {
  if (orderIds.length === 0) return { cogs: 0, coveragePct: 0 };
  const items = await chunked(orderIds, async (ids) => {
    const { data, error } = await supabase.from("order_items").select("menu_item_id, item_price, quantity")
      .in("order_id", ids).neq("status", "cancelled");
    if (error) throw error;
    return data ?? [];
  });
  const book = await loadRecipeBook(businessId);
  const { cogs, costedRevenue, itemRevenue } = recipeUsage(book, items);
  return { cogs: r2(cogs), coveragePct: itemRevenue > 0 ? Math.round((costedRevenue / itemRevenue) * 1000) / 10 : 0 };
}

// ── Profit & Loss ────────────────────────────────────────────────────────────
export type Pnl = {
  from: string;
  to: string;
  vat_rate: number;
  sales: {
    till: number;          // Z report net sales, tips not included
    platforms: number;     // delivery platforms' sales, commission included
    catering: number;      // catering paid
    total: number;         // incl. VAT
    vat: number;           // total − ex_vat
    ex_vat: number;        // total ÷ 1.2
  };
  costs: {
    ingredients: number;   // stock deliveries received
    staff: number;         // hours worked × pay rate
    expenses: number;      // other expenses, VAT claimed back taken off
    /** The same, per expense category — every category, £0 included; adds up to `expenses`. */
    expense_lines: { key: string; label: string; amount: number }[];
    commission: number;    // delivery platform commission
    card_fees: number;     // card taken × card fee rate
    paid_out: number;      // cash paid out of the till
    total: number;
  };
  profit: number;
  vat: { output: number; vat_applicable_expenses: number; input: number; net_due: number };
  recipe: { cogs: number; coverage_pct: number; profit: number };
};

export type PnlInputs = {
  from: string;
  to: string;
  vatRate: number;
  figures: FiguresTotal;
  expenses: ExpenseTotals & { byCategory?: Record<string, ExpenseTotals> };
  recipe: { cogs: number; coveragePct: number };
};

// Each expense category ex reclaimable VAT, the same way as the total. Pennies
// lost to rounding go on the largest line, so the lines add up to the total.
function expenseLines(i: PnlInputs, expensesExVat: number): Pnl["costs"]["expense_lines"] {
  const lines = EXPENSE_CATEGORIES.map((c) => {
    const t = i.expenses.byCategory?.[c.key];
    return { key: c.key as string, label: c.label as string, amount: t ? r2(t.total - extractVat(t.vatApplicableTotal, i.vatRate)) : 0 };
  });
  const diff = r2(expensesExVat - lines.reduce((s, l) => s + l.amount, 0));
  if (diff !== 0) {
    // No split given (or rounding): the remainder goes on the largest line,
    // or "Other expenses" when every line is £0.
    const biggest = lines.reduce((m, l) => (Math.abs(l.amount) > Math.abs(m.amount) ? l : m), lines[0]);
    const target = biggest.amount !== 0 ? biggest : lines.find((l) => l.key === "other")!;
    target.amount = r2(target.amount + diff);
  }
  return lines;
}

/** Pure: every P&L and VAT figure from the period's day-by-day sums. */
export function buildPnl(i: PnlInputs): Pnl {
  const f = i.figures;
  const outputVat = r2(f.total_sales - f.ex_vat);
  const inputVat = extractVat(i.expenses.vatApplicableTotal, i.vatRate);
  return {
    from: i.from,
    to: i.to,
    vat_rate: i.vatRate,
    sales: { till: f.sales.till, platforms: f.sales.platforms, catering: f.sales.catering, total: f.total_sales, vat: outputVat, ex_vat: f.ex_vat },
    costs: {
      ingredients: f.out.stock, staff: f.out.wages, expenses: f.out.expenses,
      expense_lines: expenseLines(i, f.out.expenses), commission: f.out.commission,
      card_fees: f.out.card_fee, paid_out: f.out.paid_out, total: f.money_out,
    },
    profit: f.net_total,
    vat: { output: outputVat, vat_applicable_expenses: r2(i.expenses.vatApplicableTotal), input: inputVat, net_due: r2(outputVat - inputVat) },
    // Same bottom line, with recipe cost of what was sold in place of what was bought.
    recipe: { cogs: i.recipe.cogs, coverage_pct: i.recipe.coveragePct, profit: r2(f.net_total + f.out.stock - i.recipe.cogs) },
  };
}

export async function getPnl(businessId: number, from: string, to: string): Promise<Pnl> {
  const [{ days, vatRate }, expenses, sales] = await Promise.all([
    accountsByDay(businessId, from, to),
    getOtherExpenses(businessId, from, to),
    getSalesData(businessId, from, to),
  ]);
  const recipe = await getRecipeCogs(businessId, sales.orders.map((o) => o.id));
  return buildPnl({ from, to, vatRate, figures: totalFigures(days), expenses, recipe });
}
