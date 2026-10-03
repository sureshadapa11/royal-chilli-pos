import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { tradingRangeUtc } from "@/lib/london-date";
import type { PlatformKey } from "@/lib/platforms";
import { loadRecipeBook, recipeUsage } from "@/lib/recipes";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";

// The one place money figures are worked out — always for one business
// (each is its own company, with its own P&L and VAT).
// Finance → Profit & Loss,
// Finance → VAT and the admin dashboard's summary all read getPnl(), so the
// same date range always shows the same numbers on every screen.
//
// Rules:
//   • Own sales (till, QR, website) = paid orders by order date, VAT included,
//     after discounts, minus refunds on the day the refund was given (same as
//     the Z report and the accountant export).
//   • Delivery platforms = the daily totals typed into Delivery platforms.
//   • Profit is worked out ex-VAT: VAT on sales belongs to HMRC, and VAT on
//     expenses marked "VAT applicable" is reclaimed, so neither is profit or cost.
//   • Ingredient cost = purchase orders received in the period (cash basis).

// Card fees aren't itemised anywhere we can read, so estimate them from the
// card + online takings (tips included — the fee is charged on the whole
// amount) at a typical blended rate (SumUp ~1.69%, Stripe 1.5% + 20p).
export const CARD_FEE_RATE = 0.0175;

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
      db.from("payments").select("order_id, amount, created_at, orders(total, tax, order_type)").lt("amount", 0)
        .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    allRows<{ amount: number; tip_amount: number | null }>((a, b) =>
      db.from("payments").select("amount, tip_amount").in("method", ["card", "card_online"]).gt("amount", 0)
        .gte("created_at", start).lte("created_at", end).order("id").range(a, b)),
    getPlatformSales(businessId, from, to),
  ]);

  const refunds: Refund[] = refundRows.map((p) => {
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
  const { data, error } = await bizDb(businessId)
    .from("platform_sales").select("sales_date, platform, orders, sales, commission")
    .gte("sales_date", from).lte("sales_date", to);
  // Don't take a whole report down over the platform figures.
  if (error) { console.error("platform_sales:", error.message); return []; }
  return (data ?? []).map((r) => ({ ...r, orders: Number(r.orders), sales: Number(r.sales), commission: Number(r.commission) }));
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
    own_gross: number;     // paid own orders, incl. VAT, after discounts
    refunds: number;       // refunds given in the period
    own: number;           // own_gross - refunds
    platforms: number;     // delivery platforms' gross sales
    total: number;         // own + platforms (incl. VAT)
    vat_own: number;
    vat_platforms: number;
    vat: number;           // output VAT
    ex_vat: number;        // total - vat
  };
  costs: {
    ingredients: number;   // purchase orders received
    staff: number;
    expenses: number;      // other expenses, ex reclaimable VAT
    /** The same, per expense category — every category, £0 included; adds up to `expenses`. */
    expense_lines: { key: string; label: string; amount: number }[];
    commission: number;    // delivery platform commission
    card_fees: number;     // estimate
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
  sales: SalesData;
  ingredients: number;
  staff: number;
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

/** Pure: every P&L and VAT figure from the raw inputs. */
export function buildPnl(i: PnlInputs): Pnl {
  const ownGross = i.sales.orders.reduce((s, o) => s + o.total, 0);
  const refunds = i.sales.refunds.reduce((s, r) => s + r.amount, 0);
  const own = ownGross - refunds;
  const platforms = i.sales.platforms.reduce((s, p) => s + p.sales, 0);
  const total = own + platforms;

  const vatOwn = i.sales.orders.reduce((s, o) => s + o.tax, 0) - i.sales.refunds.reduce((s, r) => s + r.vat, 0);
  const vatPlatforms = platforms * (i.vatRate / (1 + i.vatRate));
  const outputVat = r2(vatOwn + vatPlatforms);
  const exVat = r2(total - outputVat);

  const inputVat = extractVat(i.expenses.vatApplicableTotal, i.vatRate);
  const expensesExVat = r2(i.expenses.total - inputVat);
  const commission = r2(i.sales.platforms.reduce((s, p) => s + p.commission, 0));
  const cardFees = r2(i.sales.cardTaken * CARD_FEE_RATE);
  const costTotal = r2(i.ingredients + i.staff + expensesExVat + commission + cardFees);
  const profit = r2(exVat - costTotal);

  return {
    from: i.from,
    to: i.to,
    vat_rate: i.vatRate,
    sales: {
      own_gross: r2(ownGross), refunds: r2(refunds), own: r2(own), platforms: r2(platforms), total: r2(total),
      vat_own: r2(vatOwn), vat_platforms: r2(vatPlatforms), vat: outputVat, ex_vat: exVat,
    },
    costs: {
      ingredients: r2(i.ingredients), staff: r2(i.staff), expenses: expensesExVat,
      expense_lines: expenseLines(i, expensesExVat), commission, card_fees: cardFees, total: costTotal,
    },
    profit,
    vat: { output: outputVat, vat_applicable_expenses: r2(i.expenses.vatApplicableTotal), input: inputVat, net_due: r2(outputVat - inputVat) },
    // Same bottom line, with recipe cost of what was sold in place of what was bought.
    recipe: { cogs: i.recipe.cogs, coverage_pct: i.recipe.coveragePct, profit: r2(profit + i.ingredients - i.recipe.cogs) },
  };
}

export async function getPnl(businessId: number, from: string, to: string): Promise<Pnl> {
  const [sales, ingredients, staff, expenses, vatRate] = await Promise.all([
    getSalesData(businessId, from, to),
    getIngredientPurchases(businessId, from, to),
    getLabourCost(businessId, from, to),
    getOtherExpenses(businessId, from, to),
    getVatRate(businessId),
  ]);
  const recipe = await getRecipeCogs(businessId, sales.orders.map((o) => o.id));
  return buildPnl({ from, to, vatRate, sales, ingredients, staff, expenses, recipe });
}
