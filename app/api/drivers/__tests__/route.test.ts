// Driver API coverage: roster (manager), my-deliveries + availability
// (driver), assigning a delivery (manager) and the delivery state machine
// (driver, own orders only). Uses a small in-memory Supabase stand-in that
// actually applies eq/in/not filters, so business scoping (bizDb) and
// per-driver scoping are exercised for real rather than stubbed.
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

jest.mock("@/lib/supabase", () => {
  const same = (a: unknown, b: unknown) => (a === null || b === null ? a === b : String(a) === String(b));
  return {
    __esModule: true,
    default: {
      from: (table: string) => {
        const filters: ((r: Row) => boolean)[] = [];
        let op: "select" | "update" = "select";
        let payload: Row = {};
        const run = () => {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (op === "update") rows.forEach((r) => Object.assign(r, payload));
          return rows.map((r) => ({ ...r }));
        };
        const builder: Record<string, unknown> = {
          select: () => builder,
          update: (v: Row) => { op = "update"; payload = v; return builder; },
          eq: (col: string, val: unknown) => { filters.push((r) => same(r[col] ?? null, val)); return builder; },
          in: (col: string, vals: unknown[]) => { filters.push((r) => vals.some((v) => same(r[col] ?? null, v))); return builder; },
          not: (col: string, operator: string, val: unknown) => {
            if (operator === "is") filters.push((r) => !same(r[col] ?? null, val));
            else if (operator === "in") {
              const list = String(val).replace(/[()"]/g, "").split(",");
              filters.push((r) => !list.includes(String(r[col])));
            }
            return builder;
          },
          order: () => builder,
          single: () => {
            const rows = run();
            return Promise.resolve(rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not found" } });
          },
          maybeSingle: () => {
            const rows = run();
            return Promise.resolve({ data: rows[0] ?? null, error: null });
          },
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve({ data: run(), error: null }).then(resolve, reject),
        };
        return builder;
      },
      // Stand-in for complete_delivery (migration 095): same checks and
      // outcomes, records what's owed as a payment row and marks the order.
      rpc: (fn: string, args: Row) => {
        if (fn !== "complete_delivery") return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
        const o = (tables.orders ?? []).find((r) => r.id === args.p_order_id && r.business_id === args.p_business_id);
        const out = (data: Row) => Promise.resolve({ data, error: null });
        if (!o) return out({ outcome: "not_found" });
        if (o.driver_id !== args.p_driver_id) return out({ outcome: "not_your_delivery" });
        if (o.status === "cancelled") return out({ outcome: "cancelled" });
        if (o.delivery_status !== "out_for_delivery") return out({ outcome: "wrong_status", delivery_status: o.delivery_status });
        if (args.p_method !== "cash" && args.p_method !== "card") return out({ outcome: "invalid_method" });
        const due = Math.round((Number(o.total ?? 0) - Number(o.amount_paid ?? 0)) * 100) / 100;
        if (due > 0.009) {
          (tables.payments ??= []).push({ order_id: o.id, method: args.p_method, amount: due, reference: "delivery_collected", staff_id: args.p_driver_id });
          o.amount_paid = Number(o.amount_paid ?? 0) + due;
        }
        Object.assign(o, { delivery_status: "delivered", status: "paid" });
        return out({ outcome: "delivered", collected: due > 0.009 ? due : 0, order: { ...o } });
      },
    },
  };
});

// Follow-ups after a delivery collects money — not under test here.
jest.mock("@vercel/functions", () => ({ waitUntil: () => {} }));
jest.mock("@/lib/inventory", () => ({ depleteStockForOrder: () => Promise.resolve() }));
jest.mock("@/lib/customers", () => ({ awardPurchasePoints: () => Promise.resolve() }));

import { GET as listDrivers } from "@/app/api/drivers/route";
import { GET as myDeliveries } from "@/app/api/drivers/my-deliveries/route";
import { PATCH as setDriverStatus } from "@/app/api/drivers/status/route";
import { POST as assignDriver } from "@/app/api/orders/[id]/assign-driver/route";
import { POST as deliveryStatus } from "@/app/api/orders/[id]/delivery-status/route";
import { authedRequest } from "@/app/api/_test-helpers";

// "driver" isn't a StaffRole (no Staff Hub tabs) but is a valid session role.
const asDriver = (id: number, name: string, businessId = 1) => ({ id, name, role: "driver", businessId }) as unknown as SessionUser;
const manager: SessionUser = { id: 1, name: "Mo Manager", role: "manager", businessId: 1 };
const employee: SessionUser = { id: 2, name: "Eve Employee", role: "employee", businessId: 1 };
const dave = asDriver(10, "Dave");
const dina = asDriver(11, "Dina");

beforeEach(() => {
  tables = {
    role_permissions: [],
    staff: [
      { id: 1, business_id: 1, name: "Mo Manager", role: "manager", active: 1 },
      { id: 2, business_id: 1, name: "Eve Employee", role: "employee", active: 1 },
      { id: 10, business_id: 1, name: "Dave", role: "driver", active: 1, phone: "07000", vehicle_type: "car", vehicle_registration: "AB12 CDE", driver_status: "available" },
      { id: 11, business_id: 1, name: "Dina", role: "driver", active: 1, phone: null, vehicle_type: "bike", vehicle_registration: null, driver_status: "offline" },
      { id: 12, business_id: 1, name: "Old Driver", role: "driver", active: 0, driver_status: "offline" },
      { id: 20, business_id: 2, name: "Other Biz Driver", role: "driver", active: 1, driver_status: "available" },
    ],
    orders: [
      { id: 100, business_id: 1, order_type: "delivery", status: "open", driver_id: null, delivery_status: "unassigned", total: 20 },
      { id: 101, business_id: 1, order_type: "delivery", status: "open", driver_id: 10, delivery_status: "assigned", total: 15 },
      { id: 102, business_id: 1, order_type: "delivery", status: "open", driver_id: 10, delivery_status: "out_for_delivery", total: 30 },
      { id: 103, business_id: 1, order_type: "delivery", status: "paid", driver_id: 10, delivery_status: "delivered", total: 25.5 },
      { id: 104, business_id: 1, order_type: "delivery", status: "open", driver_id: 11, delivery_status: "assigned", total: 12 },
      { id: 105, business_id: 1, order_type: "delivery", status: "paid", driver_id: 11, delivery_status: "delivered", total: 10 },
      // Another business's delivery — even with a matching driver id it must stay invisible.
      { id: 200, business_id: 2, order_type: "delivery", status: "open", driver_id: 10, delivery_status: "assigned", total: 99 },
    ],
  };
});

const order = (id: number) => tables.orders.find((o) => o.id === id)!;
const staffRow = (id: number) => tables.staff.find((s) => s.id === id)!;
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function get(handler: (req: NextRequest) => Promise<Response>, url: string, user: SessionUser | null) {
  return handler(await authedRequest(url, user));
}

describe("GET /api/drivers", () => {
  it("gives a manager this business's active drivers with their delivery performance", async () => {
    const res = await get(listDrivers, "http://localhost/api/drivers", manager);
    expect(res.status).toBe(200);
    const { drivers } = await res.json();
    expect(drivers.map((d: Row) => d.id).sort()).toEqual([10, 11]);
    expect(drivers.find((d: Row) => d.id === 10)).toMatchObject({ name: "Dave", driver_status: "available", delivered_count: 1, delivered_value: 25.5 });
    expect(drivers.find((d: Row) => d.id === 11)).toMatchObject({ delivered_count: 1, delivered_value: 10 });
  });

  it("refuses drivers, employees and anonymous callers", async () => {
    for (const user of [dave, employee, null]) {
      const res = await get(listDrivers, "http://localhost/api/drivers", user);
      expect(res.status).toBe(401);
    }
  });
});

describe("GET /api/drivers/my-deliveries", () => {
  it("shows a driver only their own active deliveries in their business", async () => {
    const res = await get(myDeliveries, "http://localhost/api/drivers/my-deliveries", dave);
    expect(res.status).toBe(200);
    const { deliveries } = await res.json();
    expect(deliveries.map((d: Row) => d.id).sort()).toEqual([101, 102]);
  });

  it("gives anyone who isn't assigned deliveries an empty list", async () => {
    const res = await get(myDeliveries, "http://localhost/api/drivers/my-deliveries", manager);
    expect(res.status).toBe(200);
    expect((await res.json()).deliveries).toEqual([]);
  });

  it("401s without a session", async () => {
    const res = await get(myDeliveries, "http://localhost/api/drivers/my-deliveries", null);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/drivers/status", () => {
  const patch = async (user: SessionUser | null, body: unknown) =>
    setDriverStatus(await authedRequest("http://localhost/api/drivers/status", user, { method: "PATCH", body: JSON.stringify(body) }));

  it("lets a driver set their own availability, and only their own", async () => {
    const res = await patch(dina, { status: "on_delivery" });
    expect(res.status).toBe(200);
    expect(staffRow(11).driver_status).toBe("on_delivery");
    expect(staffRow(10).driver_status).toBe("available");
  });

  it("rejects an unknown status", async () => {
    const res = await patch(dave, { status: "sleeping" });
    expect(res.status).toBe(400);
    expect(staffRow(10).driver_status).toBe("available");
  });

  it("403s anyone who isn't a driver, 401s without a session", async () => {
    expect((await patch(manager, { status: "available" })).status).toBe(403);
    expect((await patch(employee, { status: "available" })).status).toBe(403);
    expect((await patch(null, { status: "available" })).status).toBe(401);
    expect(staffRow(1).driver_status).toBeUndefined();
    expect(staffRow(2).driver_status).toBeUndefined();
  });
});

describe("POST /api/orders/:id/assign-driver", () => {
  const assign = async (user: SessionUser | null, id: number, body: unknown) =>
    assignDriver(await authedRequest(`http://localhost/api/orders/${id}/assign-driver`, user, { method: "POST", body: JSON.stringify(body) }), params(id));

  it("lets a manager assign an unassigned delivery to one of their drivers", async () => {
    const res = await assign(manager, 100, { driver_id: 11 });
    expect(res.status).toBe(200);
    expect(order(100)).toMatchObject({ driver_id: 11, delivery_status: "assigned" });
  });

  it("refuses drivers and employees", async () => {
    expect((await assign(dave, 100, { driver_id: 10 })).status).toBe(401);
    expect((await assign(employee, 100, { driver_id: 10 })).status).toBe(401);
    expect(order(100).driver_id).toBeNull();
  });

  it("requires a driver_id that belongs to a driver of this business", async () => {
    expect((await assign(manager, 100, {})).status).toBe(400);
    expect((await assign(manager, 100, { driver_id: 2 })).status).toBe(400); // not a driver
    expect((await assign(manager, 100, { driver_id: 20 })).status).toBe(400); // another business's driver
    expect((await assign(manager, 100, { driver_id: 999 })).status).toBe(400); // doesn't exist
    expect(order(100)).toMatchObject({ driver_id: null, delivery_status: "unassigned" });
  });

  it("404s another business's order", async () => {
    const res = await assign(manager, 200, { driver_id: 11 });
    expect(res.status).toBe(404);
    expect(order(200).driver_id).toBe(10);
  });
});

describe("POST /api/orders/:id/delivery-status", () => {
  const advance = async (user: SessionUser | null, id: number, status: string, payment_method?: string) =>
    deliveryStatus(await authedRequest(`http://localhost/api/orders/${id}/delivery-status`, user, { method: "POST", body: JSON.stringify({ status, payment_method }) }), params(id));

  it("walks a driver's own delivery through assigned → out_for_delivery → delivered", async () => {
    expect((await advance(dave, 101, "out_for_delivery")).status).toBe(200);
    expect(order(101).delivery_status).toBe("out_for_delivery");
    const res = await advance(dave, 101, "delivered");
    expect(res.status).toBe(200);
    expect(order(101)).toMatchObject({ delivery_status: "delivered", status: "paid" });
    // no method given = cash, as before
    expect(tables.payments).toEqual([expect.objectContaining({ order_id: 101, method: "cash", amount: 15, reference: "delivery_collected" })]);
  });

  it("records a card payment to the driver as card, not cash", async () => {
    await advance(dave, 101, "out_for_delivery");
    expect((await advance(dave, 101, "delivered", "card")).status).toBe(200);
    expect(tables.payments).toEqual([expect.objectContaining({ order_id: 101, method: "card", amount: 15 })]);
  });

  it("rejects an unknown payment method and leaves the order out for delivery", async () => {
    await advance(dave, 101, "out_for_delivery");
    expect((await advance(dave, 101, "delivered", "voucher")).status).toBe(400);
    expect(order(101).delivery_status).toBe("out_for_delivery");
    expect(tables.payments ?? []).toEqual([]);
  });

  it("rejects skipping or reversing a step", async () => {
    expect((await advance(dave, 101, "delivered")).status).toBe(400);
    expect((await advance(dave, 102, "assigned")).status).toBe(400);
    expect((await advance(dave, 103, "out_for_delivery")).status).toBe(400);
    expect(order(101).delivery_status).toBe("assigned");
    expect(order(102).delivery_status).toBe("out_for_delivery");
  });

  it("403s a delivery assigned to someone else", async () => {
    expect((await advance(dina, 101, "out_for_delivery")).status).toBe(403);
    expect((await advance(manager, 101, "out_for_delivery")).status).toBe(403);
    expect(order(101).delivery_status).toBe("assigned");
  });

  it("can't reach another business's order, even one carrying the driver's id", async () => {
    const res = await advance(dave, 200, "out_for_delivery");
    expect(res.status).toBe(404);
    expect(order(200).delivery_status).toBe("assigned");
  });

  it("401s without a session", async () => {
    expect((await advance(null, 101, "out_for_delivery")).status).toBe(401);
  });
});
