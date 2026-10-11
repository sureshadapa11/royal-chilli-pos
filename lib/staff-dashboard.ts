import { bizDb, type BizDb } from "@/lib/business-db";
import { roleLabel } from "@/lib/roles";
import { staffIdsAt } from "@/lib/business";
import { getItemSalesInRange } from "@/lib/analytics";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";

export type DashboardStat = {
  label: string;
  value: string;
  note?: string;
  tone?: "up" | "warn" | "neutral";
  spark?: number[];
  delta?: { pct: number; dir: "up" | "down"; suffix?: string; good?: boolean };
};
export type TrendPoint = { date: string; label: string; revenue: number };
export type CostPoint = { date: string; label: string; revenue: number; cost: number };
export type HoursCostPoint = { date: string; label: string; hours: number; cost: number };
export type SlicePoint = { name: string; value: number };
export type HourPoint = { hour: string; revenue: number };
export type WeekComparePoint = { label: string; thisWeek: number; lastWeek: number };
export type HeatCell = { weekday: number; hour: number; revenue: number };
export type Alert = { tone: "rose" | "amber" | "teal"; text: string; sub?: string };
export type ShiftPerson = { name: string; since: string };
export type ReservationPreview = { name: string; time: string; partySize: number; status: string };

export type DashboardData = {
  kpis: DashboardStat[];
  // Admin — strategic/financial
  salesTrend?: TrendPoint[];
  staffCostVsRevenue?: CostPoint[];
  weekCompare?: WeekComparePoint[];
  channelMix?: SlicePoint[];
  categorySales?: SlicePoint[];
  // Manager — real-time floor ops
  onShift?: ShiftPerson[];
  reservations?: ReservationPreview[];
  byHour?: HourPoint[];
  topItems?: SlicePoint[];
  heatmap?: HeatCell[];
  // HR — people & compliance
  hoursCostTrend?: HoursCostPoint[];
  byRole?: SlicePoint[];
  alerts: Alert[];
};

type OrderRow = { id: number; total: number; order_type: string; created_at: string };
type AttendanceRow = { staff_id: number; work_date: string; net_work_seconds: number | null; late_seconds: number | null; clock_in: string | null; clock_out: string | null };

// Trading days (5am-5am UK, lib/london-date.ts): Monday's figures include
// Monday night's orders after midnight.
function todayRange() {
  const today = tradingDayStr();
  return { today, ...tradingRangeUtc(today) };
}
function lastNDays(n: number): string[] {
  const today = tradingDayStr();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDaysStr(today, -i));
  return out;
}
const dayOf = (o: { created_at: string }) => tradingDayStr(new Date(o.created_at));
const dayLabel = (dateStr: string) => new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short" });
function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const timeToMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** Restaurant-local (Europe/London) minute-of-day + ISO weekday (1=Mon..7=Sun). */
function londonNow(): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const ISO_WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { minutes: hour * 60 + minute, weekday: ISO_WD[wd] ?? 1 };
}
const CLOCKIN_GRACE_MIN = 15;

// ── Single shared fetches — each hits its table once per dashboard load. ────

async function paidOrdersInRange(db: BizDb, from: string, to: string): Promise<OrderRow[]> {
  const { data } = await db
    .from("orders")
    .select("id, total, order_type, created_at")
    .eq("is_paid", true)
    .gte("created_at", tradingRangeUtc(from).start)
    .lte("created_at", tradingRangeUtc(to).end);
  return data ?? [];
}

async function attendanceForWeek(db: BizDb, week: string[]): Promise<AttendanceRow[]> {
  const { data } = await db
    .from("attendance")
    .select("staff_id, work_date, net_work_seconds, late_seconds, clock_in, clock_out")
    .gte("work_date", week[0])
    .lte("work_date", week[week.length - 1]);
  return data ?? [];
}

async function lowStockList(db: BizDb): Promise<{ name: string; current_stock: number; unit: string }[]> {
  const { data } = await db.from("ingredients").select("name, unit, current_stock, reorder_level").eq("active", 1);
  return (data ?? [])
    .filter((i) => Number(i.current_stock) <= Number(i.reorder_level))
    .map((i) => ({ name: i.name, current_stock: Number(i.current_stock), unit: i.unit }));
}

// ── Derivations ───────────────────────────────────────────────────────────

function deriveTrend(orders: OrderRow[], week: string[]): TrendPoint[] {
  const byDay = new Map<string, number>();
  for (const o of orders) byDay.set(dayOf(o), (byDay.get(dayOf(o)) ?? 0) + Number(o.total));
  return week.map((d) => ({ date: d, label: dayLabel(d), revenue: Math.round((byDay.get(d) ?? 0) * 100) / 100 }));
}

function deriveHourlyToday(orders: OrderRow[], today: string): HourPoint[] {
  const byHour = new Map<number, number>();
  for (const o of orders) {
    if (!o.created_at.startsWith(today)) continue;
    const h = new Date(o.created_at).getUTCHours();
    byHour.set(h, (byHour.get(h) ?? 0) + Number(o.total));
  }
  return Array.from({ length: 24 }, (_, h) => h)
    .filter((h) => h >= 7 && h <= 23)
    .map((h) => ({ hour: `${h}:00`, revenue: Math.round((byHour.get(h) ?? 0) * 100) / 100 }));
}

async function deriveTopItems(orders: OrderRow[], limit = 5): Promise<SlicePoint[]> {
  if (orders.length === 0) return [];
  const items = await getItemSalesInRange(orders.map((o) => o.id));
  const byItem = new Map<string, number>();
  for (const i of items) byItem.set(i.item_name, (byItem.get(i.item_name) ?? 0) + Number(i.item_price) * i.quantity);
  return [...byItem.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value).slice(0, limit);
}

const CHANNEL_LABEL: Record<string, string> = { dine_in: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" };

function deriveChannelMix(orders: OrderRow[], week: string[]): SlicePoint[] {
  const weekSet = new Set(week);
  const byChannel = new Map<string, number>();
  for (const o of orders) {
    if (!weekSet.has(dayOf(o))) continue;
    byChannel.set(o.order_type, (byChannel.get(o.order_type) ?? 0) + Number(o.total));
  }
  return [...byChannel.entries()]
    .map(([type, value]) => ({ name: CHANNEL_LABEL[type] ?? type, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

/** Category revenue for a set of orders (already filtered to the window wanted) — one extra pass over their line items, not per-order. */
async function deriveCategorySales(db: BizDb, orderIds: number[], limit = 6): Promise<SlicePoint[]> {
  if (orderIds.length === 0) return [];
  const [items, { data: menuItems }, { data: categories }] = await Promise.all([
    getItemSalesInRange(orderIds),
    db.from("menu_items").select("id, category_id"),
    db.from("menu_categories").select("id, name"),
  ]);
  const categoryIdByItem = new Map((menuItems ?? []).map((m) => [m.id, m.category_id]));
  const nameByCategory = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const byCategory = new Map<string, number>();
  for (const i of items) {
    const catId = categoryIdByItem.get(i.menu_item_id);
    const name = (catId != null && nameByCategory.get(catId)) || "Other";
    byCategory.set(name, (byCategory.get(name) ?? 0) + Number(i.item_price) * i.quantity);
  }
  return [...byCategory.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** Typical demand pattern — day-of-week × hour, averaged over the whole window given (weeks, not just the last 7 days), so each cell reflects several occurrences of that weekday rather than a single one. */
function deriveHeatmap(orders: OrderRow[]): HeatCell[] {
  const sums = new Map<string, number>(); // `${weekday}-${hour}` -> total revenue
  for (const o of orders) {
    const d = new Date(o.created_at);
    const londonParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(d);
    const hour = Number(londonParts.find((p) => p.type === "hour")!.value);
    const wdShort = londonParts.find((p) => p.type === "weekday")!.value;
    const ISO_WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const weekday = ISO_WD[wdShort] ?? 1;
    const key = `${weekday}-${hour}`;
    sums.set(key, (sums.get(key) ?? 0) + Number(o.total));
  }
  const cells: HeatCell[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 11; hour <= 22; hour++) {
      cells.push({ weekday, hour, revenue: Math.round((sums.get(`${weekday}-${hour}`) ?? 0) * 100) / 100 });
    }
  }
  return cells;
}

/** goodDir: which direction counts as "good" for colouring — "up" for revenue-like metrics (default), "down" for cost-like ones. */
function pctDelta(cur: number, prev: number, goodDir: "up" | "down" = "up"): { pct: number; dir: "up" | "down"; good: boolean } | undefined {
  if (prev === 0) return cur === 0 ? undefined : { pct: 100, dir: "up", good: goodDir === "up" };
  const pct = ((cur - prev) / prev) * 100;
  const dir = pct >= 0 ? "up" : "down";
  return { pct: Math.round(pct * 10) / 10, dir, good: dir === goodDir };
}

/** Hours worked + labour cost per day, from closed shifts (not payroll periods, which rarely align to single days). */
async function deriveDailyCost(db: BizDb, attendance: AttendanceRow[], week: string[]): Promise<Map<string, { hours: number; cost: number }>> {
  const closed = attendance.filter((r) => r.clock_out);
  const staffIds = [...new Set(closed.map((r) => r.staff_id))];
  const { data: staffRows } = staffIds.length ? await db.from("staff").select("id, pay_rate").in("id", staffIds) : { data: [] };
  const rateById = new Map((staffRows ?? []).map((s) => [s.id, Number(s.pay_rate ?? 0)]));
  const byDay = new Map<string, { hours: number; cost: number }>();
  for (const r of closed) {
    if (!week.includes(r.work_date)) continue;
    const hours = Number(r.net_work_seconds ?? 0) / 3600;
    const cur = byDay.get(r.work_date) ?? { hours: 0, cost: 0 };
    cur.hours += hours;
    cur.cost += hours * (rateById.get(r.staff_id) ?? 0);
    byDay.set(r.work_date, cur);
  }
  return byDay;
}

/** Shifts still open from a *previous* day — clocked in, never clocked out. Today's still-open shifts are normal "on shift", not a miss. */
async function missedClockOuts(db: BizDb, today: string): Promise<{ staff_id: number; work_date: string }[]> {
  const { data } = await db.from("attendance").select("staff_id, work_date").is("clock_out", null).not("clock_in", "is", null).lt("work_date", today);
  return data ?? [];
}

/** Active staff scheduled (per their default rota) to have started by now, with no clock-in today at all. Simplified — doesn't account for one-off shift overrides. */
async function missedClockIns(db: BizDb, here: number[], today: string): Promise<{ id: number; name: string; rota_start: string }[]> {
  const { minutes, weekday } = londonNow();
  const [{ data: staffRows }, { data: clockedIn }] = await Promise.all([
    db.from("staff").select("id, name, rota_start, rota_working_days").eq("active", 1).not("rota_start", "is", null).in("id", here),
    db.from("attendance").select("staff_id").eq("work_date", today).not("clock_in", "is", null),
  ]);
  const clockedInSet = new Set((clockedIn ?? []).map((r) => r.staff_id));
  return (staffRows ?? [])
    .filter((s) => (s.rota_working_days ?? [1, 2, 3, 4, 5]).includes(weekday))
    .filter((s) => timeToMinutes(s.rota_start!.slice(0, 5)) + CLOCKIN_GRACE_MIN <= minutes)
    .filter((s) => !clockedInSet.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, rota_start: s.rota_start!.slice(0, 5) }));
}

async function todaysReservations(db: BizDb, today: string, limit = 6): Promise<ReservationPreview[]> {
  const { data } = await db
    .from("reservations")
    .select("customer_name, party_size, reservation_time, status")
    .eq("reservation_date", today)
    .not("status", "in", '("cancelled","no_show")')
    .order("reservation_time")
    .limit(limit);
  return (data ?? []).map((r) => ({ name: r.customer_name, time: r.reservation_time.slice(0, 5), partySize: r.party_size, status: r.status }));
}

/** Reservation count per day for the week, for the KPI sparkline — one grouped fetch, not one query per day. */
async function reservationsCountForWeek(db: BizDb, week: string[]): Promise<number[]> {
  const { data } = await db
    .from("reservations")
    .select("reservation_date")
    .gte("reservation_date", week[0])
    .lte("reservation_date", week[week.length - 1])
    .not("status", "in", '("cancelled","no_show")');
  const byDay = new Map<string, number>();
  for (const r of data ?? []) byDay.set(r.reservation_date, (byDay.get(r.reservation_date) ?? 0) + 1);
  return week.map((d) => byDay.get(d) ?? 0);
}

/** Shifts per day still showing no clock-out (as of now) — a proxy for "which days had a lingering miss", from data already fetched. */
function missedOutPerDay(attendance: AttendanceRow[], week: string[], today: string): number[] {
  const byDay = new Map<string, number>();
  for (const r of attendance) {
    if (r.clock_in && !r.clock_out && r.work_date < today) byDay.set(r.work_date, (byDay.get(r.work_date) ?? 0) + 1);
  }
  return week.map((d) => byDay.get(d) ?? 0);
}

// Real numbers behind the Staff Hub dashboard — genuinely different content
// per role (not the same charts relabelled): Admin gets a strategic/
// financial view, Manager gets real-time floor operations, HR gets people
// & compliance. Orders/attendance are each fetched once per load and every
// metric derives from that in memory rather than re-querying per chart.
export async function getDashboardData(businessId: number, role: string): Promise<DashboardData> {
  const db = bizDb(businessId);
  // Staff are shared across businesses — people lists are those who work here.
  const here = await staffIdsAt(businessId);
  const { today } = todayRange();
  const week = lastNDays(7);

  if (role === "admin") {
    const last14 = lastNDays(14);
    const prevWeek = last14.slice(0, 7);

    const [orders14, attendance14, lowStock, pendingLeave, pendingCorr] = await Promise.all([
      paidOrdersInRange(db, last14[0], last14[last14.length - 1]),
      attendanceForWeek(db, last14),
      lowStockList(db),
      db.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      db.from("attendance_corrections").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    const trend = deriveTrend(orders14, week);
    const prevTrend = deriveTrend(orders14, prevWeek);
    const weekOrderIds = orders14.filter((o) => week.includes(dayOf(o))).map((o) => o.id);

    // These three depend on the batch above but not on each other — run together.
    const [costMap, categorySales] = await Promise.all([
      deriveDailyCost(db, attendance14, last14),
      deriveCategorySales(db, weekOrderIds),
    ]);

    const staffCostVsRevenue: CostPoint[] = week.map((d) => ({
      date: d,
      label: dayLabel(d),
      revenue: trend.find((t) => t.date === d)?.revenue ?? 0,
      cost: Math.round((costMap.get(d)?.cost ?? 0) * 100) / 100,
    }));
    const weekCompare: WeekComparePoint[] = week.map((d, i) => ({
      label: dayLabel(d),
      thisWeek: trend[i]?.revenue ?? 0,
      lastWeek: prevTrend[i]?.revenue ?? 0,
    }));
    const channelMix = deriveChannelMix(orders14, week);

    const todayRevenue = trend.find((t) => t.date === today)?.revenue ?? 0;
    const yesterdayRevenue = trend[trend.length - 2]?.revenue ?? 0;
    const weekRevenue = trend.reduce((s, d) => s + d.revenue, 0);
    const prevWeekRevenue = prevTrend.reduce((s, d) => s + d.revenue, 0);
    const weekCost = staffCostVsRevenue.reduce((s, d) => s + d.cost, 0);
    const prevWeekCost = prevWeek.reduce((s, d) => s + (costMap.get(d)?.cost ?? 0), 0);
    const labourPct = weekRevenue > 0 ? Math.round((weekCost / weekRevenue) * 1000) / 10 : 0;
    const prevLabourPct = prevWeekRevenue > 0 ? Math.round((prevWeekCost / prevWeekRevenue) * 1000) / 10 : 0;
    const pending = (pendingLeave.count ?? 0) + (pendingCorr.count ?? 0);
    const labourDelta = labourPct - prevLabourPct;

    const alerts: Alert[] = [
      ...(lowStock.length > 0 ? [{ tone: "rose" as const, text: `${lowStock.length} item${lowStock.length === 1 ? "" : "s"} low on stock`, sub: "See Inventory for details" }] : []),
      ...(pending > 0 ? [{ tone: "amber" as const, text: `${pending} pending approval${pending === 1 ? "" : "s"}`, sub: "Leave requests & attendance corrections" }] : []),
    ];

    return {
      kpis: [
        { label: "Today's Revenue", value: `£${todayRevenue.toFixed(2)}`, spark: trend.map((t) => t.revenue), delta: pctDelta(todayRevenue, yesterdayRevenue) },
        { label: "Weekly Revenue", value: `£${weekRevenue.toFixed(2)}`, note: "last 7 days", spark: trend.map((t) => t.revenue), delta: pctDelta(weekRevenue, prevWeekRevenue) },
        { label: "Labour Cost %", value: `${labourPct}%`, note: "last 7 days", tone: labourPct > 30 ? "warn" : "neutral", spark: week.map((d) => { const rev = trend.find((t) => t.date === d)?.revenue ?? 0; const c = costMap.get(d)?.cost ?? 0; return rev > 0 ? Math.round((c / rev) * 1000) / 10 : 0; }), delta: labourDelta === 0 ? undefined : { pct: Math.round(Math.abs(labourDelta) * 10) / 10, dir: labourDelta >= 0 ? "up" : "down", suffix: " pts", good: labourDelta < 0 } },
        { label: "Pending Approvals", value: String(pending), note: pending > 0 ? "leave & corrections" : undefined, tone: "warn" },
      ],
      salesTrend: trend,
      staffCostVsRevenue,
      weekCompare,
      channelMix,
      categorySales,
      alerts,
    };
  }

  if (role === "manager" || role === "supervisor") {
    const fourWeeksAgo = addDaysStr(today, -27);
    const [orders28, attendance, lowStock, missedOuts, missedIns, reservations, tablesRes, reservationCounts] = await Promise.all([
      paidOrdersInRange(db, fourWeeksAgo, today),
      attendanceForWeek(db, week),
      lowStockList(db),
      missedClockOuts(db, today),
      missedClockIns(db, here, today),
      todaysReservations(db, today),
      db.from("restaurant_tables").select("status"),
      reservationsCountForWeek(db, week),
    ]);
    const orders = orders28.filter((o) => week.includes(dayOf(o)));

    const openToday = attendance.filter((r) => r.work_date === today && r.clock_in && !r.clock_out);
    const staffIds = [...new Set(openToday.map((r) => r.staff_id))];
    const missedOutStaffIds = [...new Set(missedOuts.map((m) => m.staff_id))];

    // These three depend on the batch above but not on each other — run together.
    const [{ data: staffNames }, { data: missedOutNames }, topItems] = await Promise.all([
      staffIds.length ? db.from("staff").select("id, name").in("id", staffIds) : Promise.resolve({ data: [] }),
      missedOutStaffIds.length ? db.from("staff").select("id, name").in("id", missedOutStaffIds) : Promise.resolve({ data: [] }),
      deriveTopItems(orders),
    ]);
    const heatmap = deriveHeatmap(orders28);
    const reservationsToday = reservationCounts[reservationCounts.length - 1] ?? 0;
    const reservationAvg = reservationCounts.slice(0, -1).reduce((s, n) => s + n, 0) / Math.max(1, reservationCounts.length - 1);
    const nameById = new Map((staffNames ?? []).map((s) => [s.id, s.name]));
    const onShift: ShiftPerson[] = openToday.map((r) => ({
      name: nameById.get(r.staff_id) ?? "?",
      since: r.clock_in ? new Date(r.clock_in).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—",
    }));
    const missedOutNameById = new Map((missedOutNames ?? []).map((s) => [s.id, s.name]));

    const tables = tablesRes.data ?? [];
    const occupied = tables.filter((t) => t.status === "occupied").length;

    const alerts: Alert[] = [
      ...missedIns.map((m) => ({ tone: "rose" as const, text: `${m.name} hasn't clocked in`, sub: `Rota'd to start at ${m.rota_start}` })),
      ...missedOuts.map((m) => ({ tone: "amber" as const, text: `${missedOutNameById.get(m.staff_id) ?? "Someone"} never clocked out`, sub: `${m.work_date} shift still open` })),
      ...lowStock.slice(0, 4).map((i) => ({ tone: "rose" as const, text: `${i.name} low on stock`, sub: `${i.current_stock} ${i.unit} left` })),
    ];

    return {
      kpis: [
        { label: "Staff Clocked In", value: String(onShift.length) },
        { label: "Missed Clock-Out", value: String(missedOuts.length), note: missedOuts.length > 0 ? "since a previous shift" : undefined, tone: missedOuts.length > 0 ? "warn" : "neutral", spark: missedOutPerDay(attendance, week, today) },
        { label: "Tables Occupied", value: `${occupied} / ${tables.length}` },
        { label: "Today's Reservations", value: String(reservations.length), spark: reservationCounts, delta: pctDelta(reservationsToday, reservationAvg) },
      ],
      onShift,
      reservations,
      byHour: deriveHourlyToday(orders, today),
      topItems,
      heatmap,
      alerts,
    };
  }

  if (role === "hr") {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const [headcount, { data: onLeave }, { data: recentHires }, { data: pendingLeaveRows }, { data: roleCounts }, attendance] = await Promise.all([
      db.from("staff").select("id", { count: "exact", head: true }).eq("active", 1).in("id", here),
      db.from("leave_requests").select("id").eq("status", "approved").lte("start_date", today).gte("end_date", today),
      db.from("staff").select("id").eq("active", 1).gte("hire_date", thirtyDaysAgo).in("id", here),
      db.from("leave_requests").select("id, staff:staff!leave_requests_staff_id_fkey(name), leave_type, start_date").eq("status", "pending").order("created_at", { ascending: false }).limit(5),
      db.from("staff").select("role").eq("active", 1).in("id", here),
      attendanceForWeek(db, week),
    ]);
    const costByDay = await deriveDailyCost(db, attendance, week);
    const hoursCostTrend: HoursCostPoint[] = week.map((d) => ({
      date: d,
      label: dayLabel(d),
      hours: Math.round((costByDay.get(d)?.hours ?? 0) * 10) / 10,
      cost: Math.round((costByDay.get(d)?.cost ?? 0) * 100) / 100,
    }));

    const byRoleMap = new Map<string, number>();
    for (const r of roleCounts ?? []) byRoleMap.set(r.role, (byRoleMap.get(r.role) ?? 0) + 1);
    const byRole: SlicePoint[] = [...byRoleMap.entries()].map(([role, value]) => ({ name: roleLabel(role), value }));

    // Day-to-day late arrivals / missed clock-outs are a manager concern
    // (they already see it on their own dashboard and correct it directly) —
    // HR's alerts stay scoped to what's actually HR's to act on.
    const alerts: Alert[] = (pendingLeaveRows ?? []).map((r) => {
      const staffRow = r.staff as unknown as { name: string } | null;
      return { tone: "amber" as const, text: `${staffRow?.name ?? "Someone"} requested leave`, sub: `${r.leave_type} · from ${r.start_date}` };
    });

    return {
      kpis: [
        { label: "Headcount", value: String(headcount.count ?? 0) },
        { label: "On Leave Today", value: String((onLeave ?? []).length) },
        { label: "Onboarding", value: String((recentHires ?? []).length), note: "hired in last 30 days" },
        { label: "Pending Leave Requests", value: String((pendingLeaveRows ?? []).length), note: (pendingLeaveRows ?? []).length > 0 ? "awaiting you" : undefined, tone: "warn" },
      ],
      hoursCostTrend,
      byRole,
      alerts,
    };
  }

  return { kpis: [], alerts: [] };
}
