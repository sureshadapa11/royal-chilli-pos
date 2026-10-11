import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { computeZReport, type ZOrder, type ZReport } from "@/lib/z-report";

// Loads a shift's Z report (lib/z-report.ts) from the database. A closed
// shift's report is snapshotted onto work_periods.z_report at close, so a
// reprint shows exactly what was printed that night even if an order is
// edited afterwards.

const ORDER_COLUMNS = "id, order_number, work_period_id, status, pay_later, total, amount_paid, discount, loyalty_discount, customer_name, created_at";

// Live calculation from the database. For an open shift, "now" is the end.
export async function calculateZReport(periodId: number): Promise<ZReport | null> {
  const { data: period } = await supabase.from("work_periods").select("*").eq("id", periodId).maybeSingle();
  if (!period) return null;

  const until = period.closed_at ?? new Date().toISOString();
  // Payments are picked up by time (everything taken while the till was
  // open), so they must be limited to this shift's business — other
  // businesses take payments at the same time.
  const db = bizDb(period.business_id);
  const [{ data: payments }, { data: ownOrders }, { data: paidOuts }, { data: staff }] = await Promise.all([
    db.from("payments").select("order_id, method, amount, tip_amount, reference").gte("created_at", period.opened_at).lte("created_at", until),
    db.from("orders").select(ORDER_COLUMNS).eq("work_period_id", periodId),
    supabase.from("cash_paid_outs").select("reason, amount").eq("work_period_id", periodId).order("created_at"),
    supabase.from("staff").select("id, name").in("id", [period.opened_by, period.closed_by].filter((x) => x != null)),
  ]);

  const orders: ZOrder[] = [...(ownOrders ?? [])];
  const known = new Set(orders.map((o) => o.id));
  const missing = [...new Set((payments ?? []).map((p) => p.order_id))].filter((id) => id != null && !known.has(id));
  if (missing.length > 0) {
    const { data: others } = await db.from("orders").select(ORDER_COLUMNS).in("id", missing);
    orders.push(...(others ?? []));
  }

  const nameOf = (id: number | null) => (staff ?? []).find((s) => s.id === id)?.name ?? null;
  return computeZReport({
    period,
    openedByName: nameOf(period.opened_by),
    closedByName: nameOf(period.closed_by),
    payments: payments ?? [],
    orders,
    paidOuts: paidOuts ?? [],
  });
}

// What to show or print for a shift: a closed shift's snapshot if it has one
// (shifts closed before snapshots existed are calculated live).
export async function getZReport(periodId: number): Promise<ZReport | null> {
  const { data } = await supabase.from("work_periods").select("status, z_report").eq("id", periodId).maybeSingle();
  if (!data) return null;
  if (data.status === "closed" && data.z_report) return data.z_report as ZReport;
  return calculateZReport(periodId);
}

// Called once, right after a shift is closed.
export async function snapshotZReport(periodId: number): Promise<ZReport | null> {
  const report = await calculateZReport(periodId);
  if (report) await supabase.from("work_periods").update({ z_report: report }).eq("id", periodId);
  return report;
}
