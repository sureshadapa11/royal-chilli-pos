import { bizDb } from "@/lib/business-db";
import { allRows, chunked, r2 } from "@/lib/finance";
import { getRefundsByOrderId } from "@/lib/analytics";
import { listLocations, staffLocationIds, type Location } from "@/lib/locations";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";
import type { SessionUser } from "@/lib/types";

// Per-location reports for managers. A staff member sees only the locations
// they're assigned to (staff_locations); one with no assignments sees none —
// explicit assignment is required. The group owner sees every location.

export type SalesChannel = "pos" | "online";

export interface LocationAnalytics {
  id: number;
  name: string;
  sales: { count: number; total: number; by_channel: Record<SalesChannel, number> };
  inventory: { ingredients_count: number; low_stock_count: number; out_of_stock_count: number };
  staff: { active_count: number; shifts_today: number };
  orders_today: number;
  top_items: { name: string; qty: number; revenue: number }[];
}

export interface LocationAnalyticsReport {
  locations: LocationAnalytics[];
  summary: { total_sales: number; total_orders: number };
}

type OrderRow = { id: number; total: number | string; staff_id: number | null; location_id: number | null };
type ItemRow = { order_id: number; item_name: string; item_price: number | string; quantity: number | string };
type IngredientRow = { id: number; location_id: number | null; current_stock: number | string; reorder_level: number | string };
type AssignmentRow = { staff_id: number; location_id: number | null };
type AttendanceRow = { staff_id: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateStr(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** start_date / end_date (YYYY-MM-DD, inclusive trading days); both default to today. */
export function parseDateRange(searchParams: URLSearchParams): { from: string; to: string } | { error: string } {
  const from = searchParams.get("start_date") || searchParams.get("end_date") || tradingDayStr();
  const to = searchParams.get("end_date") || from;
  if (!isDateStr(from) || !isDateStr(to)) return { error: "start_date and end_date must be YYYY-MM-DD" };
  if (from > to) return { error: "start_date must be on or before end_date" };
  return { from, to };
}

/** Website orders have no staff member; anything rung up by staff is the till. */
export function orderChannel(order: { staff_id: number | null }): SalesChannel {
  return order.staff_id == null ? "online" : "pos";
}

/** Active locations of the business this session may report on. */
export async function accessibleLocations(session: SessionUser): Promise<Location[]> {
  const all = await listLocations(session.businessId);
  if (session.owner) return all;
  const assigned = await staffLocationIds(session.id);
  const allowed = new Set(assigned);
  return all.filter((l) => allowed.has(l.id));
}

/**
 * Resolve a single location for a detail report: 404 if it's not one of the
 * business's active locations, 403 if this session isn't assigned to it.
 */
export async function resolveReportLocation(
  session: SessionUser,
  locationId: number,
): Promise<{ location: Location } | { error: string; status: number }> {
  if (!Number.isInteger(locationId) || locationId < 1) return { error: "Invalid location id", status: 400 };
  const all = await listLocations(session.businessId);
  const location = all.find((l) => l.id === locationId);
  if (!location) return { error: "Location not found", status: 404 };
  const accessible = await accessibleLocations(session);
  if (!accessible.some((l) => l.id === locationId)) return { error: "You cannot access this location", status: 403 };
  return { location };
}

export interface AggregateInput {
  locations: Pick<Location, "id" | "name">[];
  orders: OrderRow[];
  refundsByOrder: Map<number, number>;
  items: ItemRow[];
  ingredients: IngredientRow[];
  assignments: AssignmentRow[];
  activeStaffIds: Set<number>;
  attendanceToday: AttendanceRow[];
  ordersToday: { location_id: number | null }[];
}

/** Pure aggregation of the raw rows into the per-location report. */
export function aggregateLocationAnalytics(input: AggregateInput): LocationAnalyticsReport {
  const byId = new Map<number, LocationAnalytics>();
  const itemsByLocation = new Map<number, Map<string, { qty: number; revenue: number }>>();
  for (const l of input.locations) {
    byId.set(l.id, {
      id: l.id,
      name: l.name,
      sales: { count: 0, total: 0, by_channel: { pos: 0, online: 0 } },
      inventory: { ingredients_count: 0, low_stock_count: 0, out_of_stock_count: 0 },
      staff: { active_count: 0, shifts_today: 0 },
      orders_today: 0,
      top_items: [],
    });
    itemsByLocation.set(l.id, new Map());
  }

  const orderLocation = new Map<number, number>();
  for (const o of input.orders) {
    const loc = o.location_id != null ? byId.get(o.location_id) : undefined;
    if (!loc) continue;
    orderLocation.set(o.id, loc.id);
    const net = Number(o.total) - (input.refundsByOrder.get(o.id) ?? 0);
    loc.sales.count += 1;
    loc.sales.total += net;
    loc.sales.by_channel[orderChannel(o)] += net;
  }

  for (const it of input.items) {
    const locId = orderLocation.get(it.order_id);
    if (locId == null) continue;
    const items = itemsByLocation.get(locId)!;
    const qty = Number(it.quantity);
    const cur = items.get(it.item_name) ?? { qty: 0, revenue: 0 };
    cur.qty += qty;
    cur.revenue += qty * Number(it.item_price);
    items.set(it.item_name, cur);
  }

  for (const ing of input.ingredients) {
    const loc = ing.location_id != null ? byId.get(ing.location_id) : undefined;
    if (!loc) continue;
    const stock = Number(ing.current_stock);
    loc.inventory.ingredients_count += 1;
    if (stock <= 0) loc.inventory.out_of_stock_count += 1;
    else if (stock <= Number(ing.reorder_level)) loc.inventory.low_stock_count += 1;
  }

  const staffByLocation = new Map<number, Set<number>>();
  for (const a of input.assignments) {
    if (a.location_id == null || !byId.has(a.location_id) || !input.activeStaffIds.has(a.staff_id)) continue;
    const set = staffByLocation.get(a.location_id) ?? new Set<number>();
    set.add(a.staff_id);
    staffByLocation.set(a.location_id, set);
  }
  for (const [locId, staff] of staffByLocation) {
    const loc = byId.get(locId)!;
    loc.staff.active_count = staff.size;
    loc.staff.shifts_today = input.attendanceToday.filter((r) => staff.has(r.staff_id)).length;
  }

  for (const o of input.ordersToday) {
    const loc = o.location_id != null ? byId.get(o.location_id) : undefined;
    if (loc) loc.orders_today += 1;
  }

  for (const loc of byId.values()) {
    loc.sales.total = r2(loc.sales.total);
    loc.sales.by_channel = { pos: r2(loc.sales.by_channel.pos), online: r2(loc.sales.by_channel.online) };
    loc.top_items = [...itemsByLocation.get(loc.id)!.entries()]
      .map(([name, v]) => ({ name, qty: v.qty, revenue: r2(v.revenue) }))
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name))
      .slice(0, 5);
  }

  const locations = [...byId.values()];
  return {
    locations,
    summary: {
      total_sales: r2(locations.reduce((s, l) => s + l.sales.total, 0)),
      total_orders: locations.reduce((s, l) => s + l.sales.count, 0),
    },
  };
}

/** Load and aggregate the per-location report for `locations` over trading days from..to. */
export async function getLocationAnalytics(
  businessId: number,
  locations: Pick<Location, "id" | "name">[],
  from: string,
  to: string,
): Promise<LocationAnalyticsReport> {
  const db = bizDb(businessId);
  const ids = locations.map((l) => l.id);
  if (ids.length === 0) return { locations: [], summary: { total_sales: 0, total_orders: 0 } };
  const { start, end } = tradingRangeUtc(from, to);
  const today = tradingDayStr();
  const todayRange = tradingRangeUtc(today);

  const orders = await allRows<OrderRow>((a, b) =>
    db.from("orders").select("id, total, staff_id, location_id")
      .eq("is_paid", true).in("location_id", ids)
      .gte("created_at", start).lte("created_at", end)
      .order("id").range(a, b));
  const orderIds = orders.map((o) => o.id);

  const [refundsByOrder, items, ingredients, assignments, ordersToday, attendanceToday] = await Promise.all([
    chunked(orderIds, async (chunk) => [...(await getRefundsByOrderId(chunk)).entries()]).then((e) => new Map(e)),
    chunked(orderIds, (chunk) => allRows<ItemRow>((a, b) =>
      db.from("order_items").select("order_id, item_name, item_price, quantity")
        .in("order_id", chunk).neq("status", "cancelled").order("id").range(a, b))),
    allRows<IngredientRow>((a, b) =>
      db.from("ingredients").select("id, location_id, current_stock, reorder_level")
        .eq("active", 1).in("location_id", ids).order("id").range(a, b)),
    db.from("staff_locations").select("staff_id, location_id").in("location_id", ids)
      .then(({ data, error }) => { if (error) throw error; return (data ?? []) as AssignmentRow[]; }),
    allRows<{ location_id: number | null }>((a, b) =>
      db.from("orders").select("location_id").in("location_id", ids).neq("status", "cancelled")
        .gte("created_at", todayRange.start).lte("created_at", todayRange.end)
        .order("id").range(a, b)),
    allRows<AttendanceRow>((a, b) =>
      db.from("attendance").select("staff_id").eq("work_date", today).not("clock_in", "is", null)
        .order("id").range(a, b)),
  ]);

  const assignedIds = [...new Set(assignments.map((a) => a.staff_id))];
  const activeStaff = await chunked(assignedIds, async (chunk) => {
    const { data, error } = await db.from("staff").select("id")
      .in("id", chunk).eq("business_id", businessId).eq("active", 1);
    if (error) throw error;
    return (data ?? []) as { id: number }[];
  });

  return aggregateLocationAnalytics({
    locations,
    orders,
    refundsByOrder,
    items,
    ingredients,
    assignments,
    activeStaffIds: new Set(activeStaff.map((s) => s.id)),
    attendanceToday,
    ordersToday,
  });
}

export interface LocationInventoryRow {
  id: number;
  name: string;
  current_qty: number;
  reorder_level: number;
  last_movement_at: string | null;
  supplier_name: string | null;
}

/** Active ingredients held at one location, with their latest stock movement. */
export async function getLocationInventory(businessId: number, locationId: number): Promise<LocationInventoryRow[]> {
  const db = bizDb(businessId);
  const ingredients = await allRows<{ id: number; name: string; current_stock: number | string; reorder_level: number | string; supplier: { name: string } | { name: string }[] | null }>((a, b) =>
    db.from("ingredients").select("id, name, current_stock, reorder_level, supplier:suppliers(name)")
      .eq("active", 1).eq("location_id", locationId).order("name").order("id").range(a, b));

  const lastMovement = new Map<number, string>();
  const movements = await chunked(ingredients.map((i) => i.id), (chunk) =>
    allRows<{ ingredient_id: number; created_at: string }>((a, b) =>
      db.from("stock_movements").select("ingredient_id, created_at")
        .in("ingredient_id", chunk).eq("location_id", locationId)
        .order("created_at", { ascending: false }).order("id").range(a, b)));
  for (const m of movements) {
    const cur = lastMovement.get(m.ingredient_id);
    if (!cur || m.created_at > cur) lastMovement.set(m.ingredient_id, m.created_at);
  }

  return ingredients.map((i) => {
    const supplier = Array.isArray(i.supplier) ? i.supplier[0] : i.supplier;
    return {
      id: i.id,
      name: i.name,
      current_qty: Number(i.current_stock),
      reorder_level: Number(i.reorder_level),
      last_movement_at: lastMovement.get(i.id) ?? null,
      supplier_name: supplier?.name ?? null,
    };
  });
}

export interface LocationStaffRow {
  id: number;
  name: string;
  shifts_today: number;
  hours_logged: number;
  assignments: number[];
}

/**
 * Active staff assigned to one location: shifts clocked in today, and hours
 * logged (net, completed shifts) over trading days from..to.
 */
export async function getLocationStaff(businessId: number, locationId: number, from: string, to: string): Promise<LocationStaffRow[]> {
  const db = bizDb(businessId);
  const { data: here, error: hereError } = await db.from("staff_locations").select("staff_id").eq("location_id", locationId);
  if (hereError) throw hereError;
  const ids = [...new Set((here ?? []).map((r: { staff_id: number }) => r.staff_id))];
  if (ids.length === 0) return [];

  const { data: staff, error: staffError } = await db.from("staff").select("id, name")
    .in("id", ids).eq("business_id", businessId).eq("active", 1).order("name");
  if (staffError) throw staffError;
  const staffIds = ((staff ?? []) as { id: number; name: string }[]).map((s) => s.id);
  if (staffIds.length === 0) return [];

  const today = tradingDayStr();
  const [{ data: assignments, error: aErr }, attendance] = await Promise.all([
    db.from("staff_locations").select("staff_id, location_id").in("staff_id", staffIds),
    allRows<{ staff_id: number; work_date: string; clock_in: string | null; clock_out: string | null; net_work_seconds: number | null }>((a, b) =>
      db.from("attendance").select("staff_id, work_date, clock_in, clock_out, net_work_seconds")
        .in("staff_id", staffIds).gte("work_date", from < today ? from : today).lte("work_date", to > today ? to : today)
        .order("id").range(a, b)),
  ]);
  if (aErr) throw aErr;

  const assignmentsBy = new Map<number, number[]>();
  for (const a of (assignments ?? []) as AssignmentRow[]) {
    if (a.location_id == null) continue;
    assignmentsBy.set(a.staff_id, [...(assignmentsBy.get(a.staff_id) ?? []), a.location_id]);
  }

  return ((staff ?? []) as { id: number; name: string }[]).map((s) => {
    const rows = attendance.filter((r) => r.staff_id === s.id);
    const seconds = rows
      .filter((r) => r.work_date >= from && r.work_date <= to && r.clock_out != null)
      .reduce((sum, r) => sum + Number(r.net_work_seconds ?? 0), 0);
    return {
      id: s.id,
      name: s.name,
      shifts_today: rows.filter((r) => r.work_date === today && r.clock_in != null).length,
      hours_logged: r2(seconds / 3600),
      assignments: (assignmentsBy.get(s.id) ?? []).sort((a, b) => a - b),
    };
  });
}
