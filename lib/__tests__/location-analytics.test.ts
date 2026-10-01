import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: require("@/app/api/_test-helpers/fake-supabase").fakeSupabase,
}));

import { fakeDb } from "@/app/api/_test-helpers/fake-supabase";
import { authedRequest } from "@/app/api/_test-helpers";
import {
  accessibleLocations,
  getLocationAnalytics,
  getLocationInventory,
  getLocationStaff,
  parseDateRange,
} from "@/lib/location-analytics";
import { resolveInventoryLocation } from "@/lib/locations";
import { tradingDayStr } from "@/lib/london-date";
import { GET as getReport } from "@/app/api/analytics/locations/route";
import { GET as getInventory } from "@/app/api/analytics/locations/[id]/inventory/route";
import { GET as getStaff } from "@/app/api/analytics/locations/[id]/staff/route";

const manager: SessionUser = { id: 10, name: "Kitchen Manager", role: "manager", businessId: 1 };
const unassignedManager: SessionUser = { id: 11, name: "Floating Manager", role: "manager", businessId: 1 };
const owner: SessionUser = { id: 12, name: "Owner", role: "admin", businessId: 1, owner: true };

const DAY = "2026-09-10";
const at = (date: string, time = "12:00:00") => `${date}T${time}.000Z`;
const nowIso = () => new Date().toISOString();

beforeEach(() => {
  const today = tradingDayStr();
  fakeDb.reset({
    locations: [
      { id: 1, business_id: 1, name: "Kitchen", active: 1 },
      { id: 2, business_id: 1, name: "Warehouse", active: 1 },
      { id: 3, business_id: 2, name: "Melt House", active: 1 },
      { id: 4, business_id: 1, name: "Closed site", active: 0 },
    ],
    staff: [
      { id: 10, business_id: 1, name: "Kitchen Manager", active: 1 },
      { id: 11, business_id: 1, name: "Floating Manager", active: 1 },
      { id: 12, business_id: 1, name: "Owner", active: 1, is_owner: true },
      { id: 13, business_id: 1, name: "Cook", active: 1 },
      { id: 14, business_id: 1, name: "Left", active: 0 },
      { id: 20, business_id: 2, name: "Other biz", active: 1 },
    ],
    staff_locations: [
      { staff_id: 10, location_id: 1, assigned_at: at(DAY) },
      { staff_id: 13, location_id: 1, assigned_at: at(DAY) },
      { staff_id: 13, location_id: 2, assigned_at: at(DAY) },
      { staff_id: 14, location_id: 1, assigned_at: at(DAY) },
      { staff_id: 20, location_id: 3, assigned_at: at(DAY) },
    ],
    orders: [
      { id: 1, business_id: 1, location_id: 1, staff_id: 10, total: 20, is_paid: true, status: "paid", created_at: at(DAY) },
      { id: 2, business_id: 1, location_id: 1, staff_id: null, total: 15.5, is_paid: true, status: "paid", created_at: at(DAY, "18:30:00") },
      { id: 3, business_id: 1, location_id: 1, staff_id: 10, total: 99, is_paid: false, status: "open", created_at: at(DAY) },
      { id: 4, business_id: 1, location_id: 2, staff_id: 13, total: 40, is_paid: true, status: "paid", created_at: at(DAY) },
      { id: 5, business_id: 1, location_id: 1, staff_id: 10, total: 70, is_paid: true, status: "paid", created_at: at("2026-09-08") },
      { id: 6, business_id: 2, location_id: 3, staff_id: 20, total: 500, is_paid: true, status: "paid", created_at: at(DAY) },
      { id: 7, business_id: 1, location_id: 1, staff_id: 10, total: 5, is_paid: false, status: "open", created_at: nowIso() },
      { id: 8, business_id: 1, location_id: 1, staff_id: 10, total: 5, is_paid: false, status: "cancelled", created_at: nowIso() },
    ],
    payments: [{ id: 1, order_id: 1, amount: -5 }],
    order_items: [
      { id: 1, business_id: 1, order_id: 1, item_name: "Chicken Tikka", item_price: 10, quantity: 1, status: "served" },
      { id: 2, business_id: 1, order_id: 2, item_name: "Naan", item_price: 2.5, quantity: 3, status: "served" },
      { id: 3, business_id: 1, order_id: 2, item_name: "Chicken Tikka", item_price: 10, quantity: 1, status: "served" },
      { id: 4, business_id: 1, order_id: 1, item_name: "Lassi", item_price: 4, quantity: 5, status: "cancelled" },
      { id: 5, business_id: 1, order_id: 4, item_name: "Biryani", item_price: 12, quantity: 9, status: "served" },
    ],
    ingredients: [
      { id: 1, business_id: 1, location_id: 1, name: "Onions", active: 1, current_stock: 10, reorder_level: 2, supplier_id: 1 },
      { id: 2, business_id: 1, location_id: 1, name: "Chicken", active: 1, current_stock: 1, reorder_level: 2, supplier_id: null },
      { id: 3, business_id: 1, location_id: 1, name: "Cream", active: 1, current_stock: 0, reorder_level: 1, supplier_id: null },
      { id: 4, business_id: 1, location_id: 1, name: "Old", active: 0, current_stock: 0, reorder_level: 1, supplier_id: null },
      { id: 5, business_id: 1, location_id: 2, name: "Rice", active: 1, current_stock: 50, reorder_level: 5, supplier_id: null },
    ],
    suppliers: [{ id: 1, business_id: 1, name: "Veg Co" }],
    stock_movements: [
      { id: 1, business_id: 1, location_id: 1, ingredient_id: 1, created_at: at("2026-09-01") },
      { id: 2, business_id: 1, location_id: 1, ingredient_id: 1, created_at: at("2026-09-09") },
      { id: 3, business_id: 1, location_id: 2, ingredient_id: 1, created_at: at("2026-09-20") },
    ],
    attendance: [
      { id: 1, business_id: 1, staff_id: 10, work_date: today, clock_in: nowIso(), clock_out: null, net_work_seconds: null },
      { id: 2, business_id: 1, staff_id: 13, work_date: today, clock_in: nowIso(), clock_out: null, net_work_seconds: null },
      { id: 3, business_id: 1, staff_id: 10, work_date: DAY, clock_in: at(DAY, "09:00:00"), clock_out: at(DAY, "17:00:00"), net_work_seconds: 7.5 * 3600 },
    ],
    audit_logs: [],
    role_permissions: [],
  });
});

describe("location scoping", () => {
  it("a manager sees only their assigned locations", async () => {
    expect((await accessibleLocations(manager)).map((l) => l.name)).toEqual(["Kitchen"]);
  });

  it("the group owner sees every active location of the business", async () => {
    expect((await accessibleLocations(owner)).map((l) => l.name)).toEqual(["Kitchen", "Warehouse"]);
  });

  it("an unassigned manager sees every location (no restriction)", async () => {
    expect((await accessibleLocations(unassignedManager)).map((l) => l.id)).toEqual([1, 2]);
  });
});

describe("getLocationAnalytics", () => {
  const locs = [{ id: 1, name: "Kitchen" }, { id: 2, name: "Warehouse" }];

  it("aggregates paid sales per location, split into pos and online, net of refunds", async () => {
    const report = await getLocationAnalytics(1, locs, DAY, DAY);
    const kitchen = report.locations.find((l) => l.id === 1)!;
    expect(kitchen.sales).toEqual({ count: 2, total: 30.5, by_channel: { pos: 15, online: 15.5 } });
    const warehouse = report.locations.find((l) => l.id === 2)!;
    expect(warehouse.sales).toEqual({ count: 1, total: 40, by_channel: { pos: 40, online: 0 } });
    expect(report.summary).toEqual({ total_sales: 70.5, total_orders: 3 });
  });

  it("counts active ingredients and low / out of stock per location", async () => {
    const report = await getLocationAnalytics(1, locs, DAY, DAY);
    expect(report.locations[0].inventory).toEqual({ ingredients_count: 3, low_stock_count: 1, out_of_stock_count: 1 });
    expect(report.locations[1].inventory).toEqual({ ingredients_count: 1, low_stock_count: 0, out_of_stock_count: 0 });
  });

  it("ranks top items by quantity sold, ignoring cancelled lines", async () => {
    const report = await getLocationAnalytics(1, locs, DAY, DAY);
    expect(report.locations[0].top_items).toEqual([
      { name: "Naan", qty: 3, revenue: 7.5 },
      { name: "Chicken Tikka", qty: 2, revenue: 20 },
    ]);
    expect(report.locations[1].top_items).toEqual([{ name: "Biryani", qty: 9, revenue: 108 }]);
  });

  it("counts active assigned staff, today's shifts and today's orders", async () => {
    const report = await getLocationAnalytics(1, locs, DAY, DAY);
    expect(report.locations[0].staff).toEqual({ active_count: 2, shifts_today: 2 });
    expect(report.locations[1].staff).toEqual({ active_count: 1, shifts_today: 1 });
    expect(report.locations[0].orders_today).toBe(1);
  });

  it("filters sales by trading-day date range", async () => {
    const twoDaysBefore = await getLocationAnalytics(1, locs, "2026-09-08", "2026-09-08");
    expect(twoDaysBefore.locations[0].sales.count).toBe(1);
    expect(twoDaysBefore.locations[0].sales.total).toBe(70);

    const wide = await getLocationAnalytics(1, locs, "2026-09-08", DAY);
    expect(wide.locations[0].sales.count).toBe(3);

    const none = await getLocationAnalytics(1, locs, "2026-09-11", "2026-09-12");
    expect(none.summary).toEqual({ total_sales: 0, total_orders: 0 });
  });

  it("parses and validates date params", () => {
    expect(parseDateRange(new URLSearchParams("start_date=2026-09-01&end_date=2026-09-10"))).toEqual({ from: "2026-09-01", to: "2026-09-10" });
    expect(parseDateRange(new URLSearchParams("start_date=2026-09-10&end_date=2026-09-01"))).toHaveProperty("error");
    expect(parseDateRange(new URLSearchParams("start_date=2026-02-30"))).toHaveProperty("error");
    const today = tradingDayStr();
    expect(parseDateRange(new URLSearchParams())).toEqual({ from: today, to: today });
  });
});

describe("location detail reports", () => {
  it("lists a location's inventory with supplier and latest movement at that location", async () => {
    const rows = await getLocationInventory(1, 1);
    expect(rows.map((r) => r.name)).toEqual(["Chicken", "Cream", "Onions"]);
    expect(rows.find((r) => r.name === "Onions")).toEqual({
      id: 1, name: "Onions", current_qty: 10, reorder_level: 2, last_movement_at: at("2026-09-09"), supplier_name: "Veg Co",
    });
  });

  it("lists staff activity at a location", async () => {
    const rows = await getLocationStaff(1, 1, DAY, DAY);
    expect(rows).toEqual([
      { id: 13, name: "Cook", shifts_today: 1, hours_logged: 0, assignments: [1, 2] },
      { id: 10, name: "Kitchen Manager", shifts_today: 1, hours_logged: 7.5, assignments: [1] },
    ]);
  });
});

describe("GET /api/analytics/locations", () => {
  const get = async (user: SessionUser | null, qs = "") =>
    getReport(await authedRequest(`http://localhost/api/analytics/locations${qs}`, user));

  it("401s without a manager session", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get({ ...manager, role: "employee" })).status).toBe(401);
  });

  it("returns only the manager's assigned locations", async () => {
    const res = await get(manager, `?start_date=${DAY}&end_date=${DAY}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locations.map((l: { name: string }) => l.name)).toEqual(["Kitchen"]);
    expect(body.summary).toEqual({ total_sales: 30.5, total_orders: 2 });
  });

  it("returns every location for the group owner", async () => {
    const body = await (await get(owner, `?start_date=${DAY}&end_date=${DAY}`)).json();
    expect(body.locations.map((l: { id: number }) => l.id)).toEqual([1, 2]);
  });

  it("filters to one location, and blocks unassigned or other-business locations", async () => {
    const body = await (await get(owner, `?start_date=${DAY}&end_date=${DAY}&location_id=2`)).json();
    expect(body.locations.map((l: { id: number }) => l.id)).toEqual([2]);
    expect((await get(manager, "?location_id=2")).status).toBe(403);
    expect((await get(owner, "?location_id=3")).status).toBe(404);
  });

  it("400s on a bad date", async () => {
    expect((await get(manager, "?start_date=10-09-2026")).status).toBe(400);
  });
});

describe("GET /api/analytics/locations/:id/{inventory,staff}", () => {
  type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const call = async (handler: Handler, user: SessionUser, id: string) =>
    handler(await authedRequest(`http://localhost/api/analytics/locations/${id}`, user), { params: Promise.resolve({ id }) });

  it("returns detail for an assigned location", async () => {
    const inv = await call(getInventory, manager, "1");
    expect(inv.status).toBe(200);
    expect((await inv.json()).ingredients).toHaveLength(3);
    const staff = await call(getStaff, manager, "1");
    expect(staff.status).toBe(200);
    expect((await staff.json()).staff.map((s: { id: number }) => s.id)).toEqual([13, 10]);
  });

  it("403s for a location the manager isn't assigned to, 404s for another business's", async () => {
    expect((await call(getInventory, manager, "2")).status).toBe(403);
    expect((await call(getStaff, manager, "2")).status).toBe(403);
    expect((await call(getInventory, owner, "3")).status).toBe(404);
  });
});

describe("unassigned staff", () => {
  it("fall back to their business's primary location", async () => {
    expect(await resolveInventoryLocation(1, 11, null)).toEqual({ locationId: 1 });
    expect(await resolveInventoryLocation(2, 21, null)).toEqual({ locationId: 3 });
  });

  it("assigned staff default to their first assigned location", async () => {
    expect(await resolveInventoryLocation(1, 13, null)).toEqual({ locationId: 1 });
  });
});
