// Records the query-builder calls bizDb makes, so we can see exactly which
// business filter / stamp each operation gets.
const calls: { table: string; op: string; args: unknown[]; eq: [string, unknown][] }[] = [];

jest.mock("../supabase", () => {
  const builder = (table: string) => {
    const mk = (op: string) => (...args: unknown[]) => {
      const call = { table, op, args, eq: [] as [string, unknown][] };
      calls.push(call);
      const chain = { eq: (col: string, val: unknown) => { call.eq.push([col, val]); return chain; } };
      return chain;
    };
    return { select: mk("select"), insert: mk("insert"), upsert: mk("upsert"), update: mk("update"), delete: mk("delete") };
  };
  return { __esModule: true, default: { from: builder } };
});

import { bizDb } from "@/lib/business-db";

beforeEach(() => { calls.length = 0; });

describe("bizDb", () => {
  const db = bizDb(2);

  it("limits reads, updates and deletes on business tables to that business", () => {
    db.from("orders").select("id");
    db.from("orders").update({ status: "paid" }).eq("id", 5);
    db.from("orders").delete().eq("id", 5);
    expect(calls.map((c) => [c.op, c.eq[0]])).toEqual([
      ["select", ["business_id", 2]],
      ["update", ["business_id", 2]],
      ["delete", ["business_id", 2]],
    ]);
  });

  it("writes new rows as that business, whatever business_id was passed", () => {
    db.from("expenses").insert({ amount: 5, business_id: 1 });
    db.from("expenses").insert([{ amount: 1 }, { amount: 2 }]);
    db.from("platform_sales").upsert({ sales: 10 }, { onConflict: "business_id,sales_date,platform" });
    expect(calls[0].args[0]).toEqual({ amount: 5, business_id: 2 });
    expect(calls[1].args[0]).toEqual([{ amount: 1, business_id: 2 }, { amount: 2, business_id: 2 }]);
    expect(calls[2].args).toEqual([{ sales: 10, business_id: 2 }, { onConflict: "business_id,sales_date,platform" }]);
  });

  it("can't move a row to another business with an update", () => {
    db.from("menu_items").update({ name: "x", business_id: 1 });
    expect(calls[0].args[0]).toEqual({ name: "x" });
  });

  it("staff pass straight through (filtered explicitly by staffIdsAt / staffWorksAt)", () => {
    db.from("staff").select("id");
    expect(calls[0].eq).toEqual([]);
  });

  it("customers, suppliers and the rewards scheme are per business (079)", () => {
    db.from("customers").insert({ name: "A" });
    db.from("suppliers").select("id");
    db.from("loyalty_rewards").select("id");
    expect(calls[0].args[0]).toEqual({ name: "A", business_id: 2 });
    expect(calls[1].eq).toEqual([["business_id", 2]]);
    expect(calls[2].eq).toEqual([["business_id", 2]]);
  });

  it("scopes tenant-owned child tables added in 084", () => {
    for (const table of [
      "cash_paid_outs", "customer_addresses", "loyalty_tier_changes",
      "menu_item_modifier_groups", "modifier_options", "order_items", "order_item_modifiers",
      "payroll_entries", "payroll_payments", "purchase_order_items", "recipe_ingredients", "stock_take_lines",
    ]) {
      db.from(table).select("id");
    }
    expect(calls).toHaveLength(12);
    expect(calls.every((call) => call.eq[0]?.[0] === "business_id" && call.eq[0]?.[1] === 2)).toBe(true);
  });

  it("refuses a missing or bad business id", () => {
    expect(() => bizDb(0)).toThrow();
    expect(() => bizDb(Number.NaN)).toThrow();
  });
});
