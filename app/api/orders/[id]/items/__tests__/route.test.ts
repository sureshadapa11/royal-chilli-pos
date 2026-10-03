// Regression coverage for: voiding the last active item on an order used to
// leave its table stuck "occupied" forever (the item-level void action never
// checked whether the order was now empty). See lib/orders.ts's
// cancelOrderAndFreeTable for the shared fix.
//
// Mock strategy: each table gets a FIFO queue of responses, consumed one per
// .from(table) call in the exact order the route code makes them — this
// route makes several sequential calls to "orders" and "order_items" within
// a single request (recalcTotals, the remaining-items check, the table
// lookup), so a fixed single-shape mock (as used elsewhere) isn't enough here.
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";

type Resp = { data?: unknown; error?: unknown; count?: number };
let queues: Record<string, Resp[]>;
let tablesUpdatePayloads: Record<string, unknown>[];
let ordersUpdatePayloads: Record<string, unknown>[];
let mockQueries: { table: string; eq: [string, unknown][] }[];

function queue(table: string, resp: Resp) {
  (queues[table] ||= []).push(resp);
}

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: {
    from: (table: string) => {
      const q = queues[table];
      if (!q || q.length === 0) throw new Error(`No queued response for table "${table}"`);
      const call = { table, eq: [] as [string, unknown][] };
      mockQueries.push(call);
      const resp = q.shift()!;
      const builder: Record<string, unknown> = {};
      const passthrough = ["select", "eq", "neq", "in", "gte", "lte", "not", "order", "limit", "insert"];
      for (const m of passthrough) builder[m] = (...args: unknown[]) => {
        if (m === "eq") call.eq.push(args as [string, unknown]);
        return builder;
      };
      builder.update = (vals: Record<string, unknown>) => {
        if (table === "restaurant_tables") tablesUpdatePayloads.push(vals);
        if (table === "orders") ordersUpdatePayloads.push(vals);
        return builder;
      };
      builder.single = () => Promise.resolve(resp);
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (resolve: (v: Resp) => void, reject: (e: unknown) => void) => Promise.resolve(resp).then(resolve, reject);
      return builder;
    },
  },
}));

import { PUT } from "@/app/api/orders/[id]/items/route";
import { authedRequest } from "@/app/api/_test-helpers";

const manager: SessionUser = { id: 2, name: "A Manager", role: "manager", businessId: 1 };

async function voidItem(orderId: string, itemId: number) {
  const req = await authedRequest(`http://localhost/api/orders/${orderId}/items`, manager, {
    method: "PUT",
    body: JSON.stringify({ itemId, action: "void" }),
  });
  return PUT(req as NextRequest, { params: Promise.resolve({ id: orderId }) });
}

beforeEach(() => {
  queues = {};
  tablesUpdatePayloads = [];
  ordersUpdatePayloads = [];
  mockQueries = [];
});

describe("PUT /api/orders/[id]/items — void action closes an emptied-out order", () => {
  it("cancels the order and frees the table when the last active item is voided", async () => {
    queue("orders", { data: [{ id: 1 }], error: null }); // order belongs to this business
    queue("orders", { data: { status: "pending", table_id: 5 }, error: null }); // paid-status guard read
    queue("order_items", { error: null }); // the void update itself
    queue("orders", { data: { discount: 0, service_charge_pct: 0 }, error: null }); // recalcTotals read
    queue("order_items", { data: [], error: null }); // recalcTotals: no active items left
    queue("orders", { data: null, error: null }); // recalcTotals write
    queue("order_items", { data: null, error: null, count: 0 }); // remaining-items check
    queue("orders", { data: null, error: null }); // cancelOrderAndFreeTable's own status/email read
    queue("orders", { data: null, error: null }); // cancelOrderAndFreeTable's order update
    queue("restaurant_tables", { data: null, error: null }); // cancelOrderAndFreeTable's table update

    const res = await voidItem("77", 1);
    expect(res.status).toBe(200);
    expect(ordersUpdatePayloads).toContainEqual(expect.objectContaining({ status: "cancelled" }));
    expect(tablesUpdatePayloads).toContainEqual({ status: "available", self_order_enabled: false });
  });

  it("does NOT cancel the order or free the table when other active items remain", async () => {
    queue("orders", { data: [{ id: 1 }], error: null }); // order belongs to this business
    queue("orders", { data: { status: "pending", table_id: 5 }, error: null }); // paid-status guard read
    queue("order_items", { error: null }); // the void update itself
    queue("orders", { data: { discount: 0, service_charge_pct: 0 }, error: null }); // recalcTotals read
    queue("order_items", { data: [{ item_price: 5, quantity: 1 }], error: null }); // one item still active
    queue("orders", { data: null, error: null }); // recalcTotals write
    queue("order_items", { data: null, error: null, count: 1 }); // remaining-items check: 1 left

    const res = await voidItem("77", 1);
    expect(res.status).toBe(200);
    expect(ordersUpdatePayloads.some((u) => u.status === "cancelled")).toBe(false);
    expect(tablesUpdatePayloads).toHaveLength(0);
  });

  it("refuses to void an item on an already-paid order", async () => {
    queue("orders", { data: [{ id: 1 }], error: null }); // order belongs to this business
    queue("orders", { data: { status: "paid", is_paid: true, table_id: 5 }, error: null }); // paid-status guard read

    const res = await voidItem("77", 1);
    expect(res.status).toBe(409);
    expect(ordersUpdatePayloads).toHaveLength(0);
    expect(tablesUpdatePayloads).toHaveLength(0);
  });

  it("treats another business's order as not found, and changes nothing", async () => {
    queue("orders", { data: [], error: null }); // not this business's order
    const res = await voidItem("1", 10);
    expect(res.status).toBe(404);
    expect(ordersUpdatePayloads).toHaveLength(0);
    expect(tablesUpdatePayloads).toHaveLength(0);
    expect(mockQueries).toEqual([{ table: "orders", eq: [["business_id", 1]] }]);
  });
});
