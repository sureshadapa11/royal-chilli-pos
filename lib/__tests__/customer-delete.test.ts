// A fake database that records every write, so the test can check what
// "Delete my account" changes without touching Supabase.
type Op = { table: string; op: string; values?: Record<string, unknown>; filters: [string, string, unknown][] };
const ops: Op[] = [];
let customerRow: Record<string, unknown> | null = null;
let liveOrders = 0;

function builder(table: string) {
  const state: Op = { table, op: "select", filters: [] };
  const b = {
    select: (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) state.op = "count"; return b; },
    insert: (values: Record<string, unknown>) => { state.op = "insert"; state.values = values; ops.push(state); return b; },
    update: (values: Record<string, unknown>) => { state.op = "update"; state.values = values; ops.push(state); return b; },
    delete: () => { state.op = "delete"; ops.push(state); return b; },
    eq: (c: string, v: unknown) => { state.filters.push(["eq", c, v]); return b; },
    in: (c: string, v: unknown) => { state.filters.push(["in", c, v]); return b; },
    gte: (c: string, v: unknown) => { state.filters.push(["gte", c, v]); return b; },
    ilike: (c: string, v: unknown) => { state.filters.push(["ilike", c, v]); return b; },
    maybeSingle: () => Promise.resolve({ data: customerRow, error: null }),
    then: (resolve: (r: unknown) => void) => resolve(state.op === "count" ? { count: liveOrders, error: null } : { data: null, error: null }),
  };
  return b;
}

jest.mock("@/lib/supabase", () => ({ __esModule: true, default: { from: (t: string) => builder(t) } }));
import { deleteCustomerAccount } from "@/lib/customer-delete";

const writes = (table: string) => ops.filter((o) => o.table === table);

beforeEach(() => {
  ops.length = 0;
  liveOrders = 0;
  customerRow = { id: 7, business_id: 1, email: "sam_1@example.com", loyalty_points: 120, merged_into: null, deleted_at: null };
});

describe("Delete my account", () => {
  it("wipes the customer's details and marks the record deleted", async () => {
    expect(await deleteCustomerAccount(7)).toEqual({ ok: true });
    const c = writes("customers").find((o) => o.op === "update")!;
    expect(c.values).toMatchObject({ name: "Deleted customer", phone: null, email: null, password_hash: null, date_of_birth: null, marketing_consent: false });
    expect(c.values!.deleted_at).toEqual(expect.any(String));
  });

  it("zeroes points through the ledger and cancels unused vouchers", async () => {
    await deleteCustomerAccount(7);
    expect(writes("loyalty_transactions")[0].values).toMatchObject({ customer_id: 7, points_delta: -120, reason: "account_deleted" });
    expect(writes("loyalty_redemptions")[0]).toMatchObject({ values: { status: "cancelled" }, filters: expect.arrayContaining([["eq", "status", "issued"]]) });
  });

  it("cancels upcoming bookings and keeps orders without the person's details", async () => {
    await deleteCustomerAccount(7);
    const [cancel, anon] = writes("reservations");
    expect(cancel.values).toEqual({ status: "cancelled" });
    expect(cancel.filters).toEqual(expect.arrayContaining([["gte", "reservation_date", expect.any(String)]]));
    expect(anon.values).toMatchObject({ customer_name: "Deleted customer", customer_phone: null, customer_email: null });
    expect(writes("orders")[0].values).toMatchObject({ customer_name: "Deleted customer", customer_phone: null, customer_address: null });
    expect(writes("orders").some((o) => o.op === "delete")).toBe(false);
  });

  it("removes addresses and the newsletter sign-up (email matched exactly)", async () => {
    await deleteCustomerAccount(7);
    expect(writes("customer_addresses")[0].op).toBe("delete");
    expect(writes("newsletter_subscribers")[0].filters).toContainEqual(["ilike", "email", "sam\\_1@example.com"]);
  });

  it("is blocked while an order is still in progress", async () => {
    liveOrders = 1;
    const r = await deleteCustomerAccount(7);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(ops).toEqual([]);
  });

  it("skips the ledger when there are no points", async () => {
    customerRow!.loyalty_points = 0;
    await deleteCustomerAccount(7);
    expect(writes("loyalty_transactions")).toEqual([]);
  });
});
