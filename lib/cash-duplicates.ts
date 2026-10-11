import type { BizDb } from "@/lib/business-db";
import { londonDateStr, londonDayRangeUtc } from "@/lib/london-date";

// The same cash spend entered twice — once through the staff link's Cash In /
// Out and once in the Staff Hub (expense, stock delivery, supplier payment) or
// on the till (Cash Out) — would count twice in Money out. Matching is "same
// amount, same day": the Staff Hub asks before saving such a match, and the
// Cash in/out list flags them.

const pennies = (n: number | string) => Math.round(Number(n) * 100);

/** A cash-out from the staff link with this amount on this day, if any. */
export async function linkCashOutMatch(db: BizDb, date: string, amount: number): Promise<string | null> {
  const { data } = await db.from("cash_movements").select("reason, amount")
    .eq("direction", "out").eq("movement_date", date).eq("amount", Math.round(amount * 100) / 100).limit(1);
  const m = data?.[0];
  return m ? `Staff already entered £${Number(m.amount).toFixed(2)} cash out that day through the staff link ("${m.reason}"). If it's the same spend, don't save it again.` : null;
}

/** For each "date|pennies", what else in the Staff Hub or on the till has that amount that day. */
export async function otherEntriesByDayAmount(db: BizDb, from: string, to: string): Promise<Map<string, string>> {
  const { start } = londonDayRangeUtc(from);
  const { end } = londonDayRangeUtc(to);
  const [exp, pos, pays, till] = await Promise.all([
    db.from("expenses").select("expense_date, amount, description").gte("expense_date", from).lte("expense_date", to),
    db.from("purchase_orders").select("received_date, total_cost, order_number").eq("status", "received").gte("received_date", from).lte("received_date", to),
    db.from("supplier_payments").select("paid_at, amount").gte("paid_at", start).lte("paid_at", end),
    db.from("cash_paid_outs").select("created_at, amount, reason").gte("created_at", start).lte("created_at", end),
  ]);
  const out = new Map<string, string>();
  const put = (date: string, amount: number | string, label: string) => {
    const k = `${date}|${pennies(amount)}`;
    if (!out.has(k)) out.set(k, label);
  };
  for (const e of exp.data ?? []) put(e.expense_date, e.amount, `Expense: ${e.description}`);
  for (const p of pos.data ?? []) put(p.received_date, p.total_cost, `Stock delivery ${p.order_number}`);
  for (const p of pays.data ?? []) put(londonDateStr(new Date(p.paid_at)), p.amount, "Supplier payment");
  for (const t of till.data ?? []) put(londonDateStr(new Date(t.created_at)), t.amount, `Till cash out: ${t.reason}`);
  return out;
}

export const dayAmountKey = (date: string, amount: number | string) => `${date}|${pennies(amount)}`;
