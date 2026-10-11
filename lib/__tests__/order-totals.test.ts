import { computeBill, splitByFood } from "@/lib/order-totals";

// Order of operations: subtotal (already VAT-inclusive) -> discount ->
// service charge -> total. Tip is never part of this (per-payment,
// separate). `tax` is the VAT component embedded in the final total,
// reported for receipts/VAT-return purposes — it never adds to what the
// customer pays, since the menu price they saw already included it.
describe("computeBill", () => {
  it("reports the embedded VAT component with no discount or service charge", () => {
    const bill = computeBill({ subtotal: 100, discountType: null, discountPct: null, discountAmount: 0, serviceChargePct: 0 });
    // total stays 100 (nothing added); VAT component of an inclusive £100 = 100 - 100/1.2 = 16.67
    expect(bill).toMatchObject({ subtotal: 100, tax: 16.67, subtotalWithTax: 100, discount: 0, discounted: 100, serviceChargeAmount: 0, total: 100 });
  });

  it("applies a percent discount directly to the inclusive subtotal", () => {
    const bill = computeBill({ subtotal: 100, discountType: "percent", discountPct: 10, discountAmount: 0, serviceChargePct: 0 });
    // 10% of 100 = 10; discounted total = 90; VAT component of 90 = 15
    expect(bill).toMatchObject({ discount: 10, discounted: 90, total: 90, tax: 15 });
  });

  it("applies a flat-amount discount off the inclusive subtotal", () => {
    const bill = computeBill({ subtotal: 100, discountType: "amount", discountPct: null, discountAmount: 20, serviceChargePct: 0 });
    expect(bill).toMatchObject({ subtotalWithTax: 100, discount: 20, discounted: 80, total: 80 });
  });

  it("clamps the discount so it never exceeds the subtotal (never a negative total)", () => {
    const bill = computeBill({ subtotal: 10, discountType: "amount", discountPct: null, discountAmount: 200, serviceChargePct: 0 });
    expect(bill).toMatchObject({ subtotalWithTax: 10, discount: 10, discounted: 0, serviceChargeAmount: 0, total: 0, tax: 0 });
  });

  it("applies service charge on the post-discount amount, last", () => {
    const bill = computeBill({ subtotal: 100, discountType: "amount", discountPct: null, discountAmount: 20, serviceChargePct: 10 });
    // discounted = 80; service charge = 10% of 80 = 8
    expect(bill).toMatchObject({ discounted: 80, serviceChargeAmount: 8, total: 88 });
  });

  it("charges VAT on the food only — never on the service charge", () => {
    const bill = computeBill({ subtotal: 120, discountType: null, discountPct: null, discountAmount: 0, serviceChargePct: 10 });
    // food 120 → VAT 20; service charge 12 carries none
    expect(bill).toMatchObject({ serviceChargeAmount: 12, total: 132, tax: 20 });
  });

  it("takes a staff discount AND loyalty off the same bill, VAT on what's left", () => {
    const bill = computeBill({ subtotal: 100, discountType: "percent", discountPct: 10, discountAmount: 0, serviceChargePct: 10, loyaltyAmount: 30 });
    // 100 − 10 discount − 30 loyalty = 60 food; +6 service charge = 66; VAT on 60 = 10
    expect(bill).toMatchObject({ discount: 10, loyalty: 30, discounted: 60, serviceChargeAmount: 6, total: 66, tax: 10 });
  });

  it("never lets loyalty take the bill below zero", () => {
    const bill = computeBill({ subtotal: 20, discountType: "amount", discountPct: null, discountAmount: 15, serviceChargePct: 0, loyaltyAmount: 10 });
    expect(bill).toMatchObject({ discount: 15, loyalty: 5, discounted: 0, total: 0, tax: 0 });
  });

  it("treats a null discount type as a legacy flat amount, same as \"amount\"", () => {
    const bill = computeBill({ subtotal: 100, discountType: null, discountPct: null, discountAmount: 10, serviceChargePct: 0 });
    expect(bill).toMatchObject({ discount: 10, discounted: 90, total: 90 });
  });
});

// Mirrors permissions.test.ts's approach: mock the Supabase client so
// recalcTotals can run against controlled order/order_items data without a
// live database.
type Row = Record<string, unknown>;

let orderRow: Row | null;
let itemRows: Row[];
let updateSpy: jest.Mock;
let businessFilters: [string, unknown][];

jest.mock("../supabase", () => ({
  __esModule: true,
  default: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (field: string, value: unknown) => {
        if (field === "business_id") businessFilters.push([field, value]);
        return builder;
      };
      builder.neq = () => builder;
      builder.single = () => Promise.resolve({ data: orderRow, error: null });
      builder.update = (vals: Row) => {
        updateSpy(vals);
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve({ data: table === "order_items" ? itemRows : null, error: null }).then(resolve, reject);
      return builder;
    },
  },
}));

import { recalcTotals } from "@/lib/order-totals";

beforeEach(() => {
  updateSpy = jest.fn();
  businessFilters = [];
  orderRow = { discount: 0, discount_type: null, discount_pct: null, service_charge_pct: 0 };
  itemRows = [];
});

describe("recalcTotals", () => {
  it("sums active items (already VAT-inclusive) and writes back the computed bill", async () => {
    itemRows = [{ item_price: 10, quantity: 2 }, { item_price: 5, quantity: 1 }];
    await recalcTotals("order-1", 2);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 25, tax: 4.17, service_charge_amount: 0, total: 25 })
    );
    expect(businessFilters).toEqual([["business_id", 2], ["business_id", 2], ["business_id", 2]]);
  });

  it("does NOT overwrite the stored discount for a flat-amount discount (it's the raw rule, not a cache)", async () => {
    orderRow = { discount: 20, discount_type: "amount", discount_pct: null, service_charge_pct: 0 };
    itemRows = [{ item_price: 100, quantity: 1 }];
    await recalcTotals("order-1", 1);
    const written = updateSpy.mock.calls[0][0];
    expect(written).not.toHaveProperty("discount");
    expect(written.total).toBe(80); // 100 inclusive - 20 discount
  });

  it("DOES refresh the stored discount for a percent discount (it's a derived display cache)", async () => {
    orderRow = { discount: 0, discount_type: "percent", discount_pct: 10, service_charge_pct: 0 };
    itemRows = [{ item_price: 100, quantity: 1 }];
    await recalcTotals("order-1", 1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ discount: 10, total: 90 }));
  });

  it("applies service charge after the discount", async () => {
    orderRow = { discount: 20, discount_type: "amount", discount_pct: null, service_charge_pct: 10 };
    itemRows = [{ item_price: 100, quantity: 1 }];
    await recalcTotals("order-1", 1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ service_charge_amount: 8, total: 88 }));
  });

  it("keeps a staff discount and takes the stored loyalty amount off too", async () => {
    orderRow = { discount: 20, discount_type: "amount", discount_pct: null, service_charge_pct: 0, loyalty_discount: 10 };
    itemRows = [{ item_price: 100, quantity: 1 }];
    await recalcTotals("order-1", 1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ total: 70 }));
  });
});

// A table bill with several rounds: the whole bill's total is shared over
// the rounds by their food, to the penny.
describe("splitByFood", () => {
  it("shares a £5-off bill over two rounds by their food", () => {
    // Fries £2.95 + soups £13.90 = £16.85, £5 off → £11.85 to pay
    const shares = splitByFood(11.85, [2.95, 13.9]);
    expect(shares).toEqual([2.07, 9.78]);
    expect(Math.round((shares[0] + shares[1]) * 100) / 100).toBe(11.85);
  });
  it("always adds up to the bill exactly (pennies go to the biggest round)", () => {
    const shares = splitByFood(10, [1, 1, 1]);
    expect(Math.round(shares.reduce((s, x) => s + x, 0) * 100) / 100).toBe(10);
    expect(shares.every((x) => x >= 0)).toBe(true);
  });
  it("a fully covered bill is £0 on every round", () => {
    expect(splitByFood(0, [2.95, 13.9])).toEqual([0, 0]);
  });
  it("no food on any round: the first round takes it", () => {
    expect(splitByFood(3, [0, 0])).toEqual([3, 0]);
  });
});
