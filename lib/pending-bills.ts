import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { r2 } from "@/lib/finance";
import { tradingDayStr } from "@/lib/london-date";
import { addDays } from "@/lib/admin-dashboard";

// Pending bills (migration 134, agreed 2026-10-14): a bill left unpaid is
// entered once; payments (part payments too) are recorded against it, so
// what's owed is worked out. Not sales — the bill is in that day's Z report
// total. A cash payment goes straight into the Safe (owner, 2026-10-15; see
// safeBook in lib/cash-book.ts), never the till, so neither changes sales or
// the cash check. The month sheet's Pending column comes from here.

export type BillPayment = { id: number; date: string; amount: number; method: string; by: string | null };
export type Bill = {
  id: number; customer: string; phone: string | null; date: string; amount: number; notes: string | null;
  cancelled: boolean; paid: number; owed: number; payments: BillPayment[];
};

const BILL_COLUMNS = "id, customer, phone, bill_date, amount, notes, cancelled";
type BillRow = { id: number; customer: string; phone: string | null; bill_date: string; amount: number; notes: string | null; cancelled: boolean };
type PayRow = { id: number; bill_id: number; paid_date: string; amount: number; method: string; staff_id: number | null };

async function withPayments(businessId: number, bills: BillRow[]): Promise<Bill[]> {
  if (!bills.length) return [];
  const { data: pays } = await bizDb(businessId).from("pending_bill_payments")
    .select("id, bill_id, paid_date, amount, method, staff_id").in("bill_id", bills.map((b) => b.id)).order("paid_date").order("id");
  const ids = [...new Set((pays ?? []).map((p) => p.staff_id).filter(Boolean))] as number[];
  const { data: who } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] as { id: number; name: string }[] };
  const nameOf = (id: number | null) => (who ?? []).find((w) => w.id === id)?.name ?? null;
  return bills.map((b) => {
    const payments = ((pays ?? []) as PayRow[]).filter((p) => p.bill_id === b.id)
      .map((p) => ({ id: p.id, date: p.paid_date, amount: r2(Number(p.amount)), method: p.method, by: nameOf(p.staff_id) }));
    const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
    const amount = r2(Number(b.amount));
    return { id: b.id, customer: b.customer, phone: b.phone, date: b.bill_date, amount, notes: b.notes, cancelled: b.cancelled,
      paid, owed: b.cancelled ? 0 : r2(Math.max(0, amount - paid)), payments };
  });
}

/** Every bill still owed, plus the month's bills. */
export async function listBills(businessId: number, month: string): Promise<{ owed: Bill[]; month: Bill[] }> {
  const db = bizDb(businessId);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const [{ data: inMonth }, { data: open }] = await Promise.all([
    db.from("pending_bills").select(BILL_COLUMNS).gte("bill_date", from).lte("bill_date", to).order("bill_date").order("id"),
    db.from("pending_bills").select(BILL_COLUMNS).eq("cancelled", false).order("bill_date").order("id"),
  ]);
  const all = await withPayments(businessId, [...new Map([...(inMonth ?? []), ...(open ?? [])].map((b) => [b.id, b as BillRow])).values()]);
  const byId = new Map(all.map((b) => [b.id, b]));
  return {
    owed: (open ?? []).map((b) => byId.get(b.id)!).filter((b) => b.owed > 0),
    month: (inMonth ?? []).map((b) => byId.get(b.id)!),
  };
}

export async function getBill(businessId: number, id: number): Promise<Bill | null> {
  const { data } = await bizDb(businessId).from("pending_bills").select(BILL_COLUMNS).eq("id", id).maybeSingle();
  return data ? (await withPayments(businessId, [data as BillRow]))[0] : null;
}

/** Bills a payment can be recorded against (staff link): still owed. */
export async function payableBills(businessId: number): Promise<{ id: number; name: string; owed: number }[]> {
  const { owed } = await listBills(businessId, tradingDayStr().slice(0, 7));
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return owed.map((b) => ({ id: b.id, name: `${b.customer} · ${day(b.date)} · £${b.owed.toFixed(2)} owed`, owed: b.owed }));
}

/** What was still owed at the end of each day from..to (the month sheet's Pending). */
export async function billsOwedByDay(businessId: number, from: string, to: string): Promise<Map<string, number>> {
  const db = bizDb(businessId);
  const [{ data: bills }, { data: pays }] = await Promise.all([
    db.from("pending_bills").select("id, bill_date, amount, cancelled").lte("bill_date", to),
    db.from("pending_bill_payments").select("bill_id, paid_date, amount").lte("paid_date", to),
  ]);
  const live = (bills ?? []).filter((b) => !b.cancelled);
  const out = new Map<string, number>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let owed = 0;
    for (const b of live) {
      if (b.bill_date > d) continue;
      const paid = (pays ?? []).filter((p) => p.bill_id === b.id && p.paid_date <= d).reduce((s, p) => s + Number(p.amount), 0);
      owed += Math.max(0, Number(b.amount) - paid);
    }
    out.set(d, r2(owed));
  }
  return out;
}

/** Everything still owed right now. */
export async function billsOwedNow(businessId: number): Promise<number> {
  const { owed } = await listBills(businessId, tradingDayStr().slice(0, 7));
  return r2(owed.reduce((s, b) => s + b.owed, 0));
}
