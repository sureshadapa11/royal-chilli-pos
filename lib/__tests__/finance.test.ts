jest.mock("../supabase", () => ({ __esModule: true, default: {} }));

import { buildPnl, extractVat, type SalesData } from "@/lib/finance";
import { recipeUsage, type RecipeBook } from "@/lib/recipes";

describe("extractVat", () => {
  it("extracts VAT from a VAT-inclusive gross amount at the standard 20% rate", () => {
    // gross * rate/(1+rate) = 100 * 0.2/1.2 = 16.666... -> rounds to 16.67
    expect(extractVat(100, 0.2)).toBeCloseTo(16.67, 2);
  });

  it("extracts VAT at the reduced 5% rate", () => {
    // 100 * 0.05/1.05 = 4.7619... -> rounds to 4.76
    expect(extractVat(100, 0.05)).toBeCloseTo(4.76, 2);
  });

  it("returns 0 for a zero-rated item", () => {
    expect(extractVat(100, 0)).toBe(0);
  });

  it("rounds to the nearest penny", () => {
    // 11.45 * 0.2/1.2 = 1.9083... -> rounds to 1.91
    expect(extractVat(11.45, 0.2)).toBeCloseTo(1.91, 2);
  });
});

describe("buildPnl", () => {
  // Worked by hand:
  //   own gross 120 + 60 = 180, refund 30 (VAT 30 × 10/60 = 5) → own 150
  //   platforms 240 → total 390
  //   VAT: own 20 + 10 − 5 = 25, platforms 240 × 0.2/1.2 = 40 → 65; ex-VAT 325
  //   expenses 36 of which 24 VAT-applicable → input VAT 4 → expenses ex-VAT 32
  //   costs 50 + 40 + 32 + 60 commission + 1.75 card fees (1.75% of 100) = 183.75
  //   profit 325 − 183.75 = 141.25; VAT due 65 − 4 = 61; recipe basis 141.25 + 50 − 30 = 161.25
  const sales: SalesData = {
    orders: [
      { id: 1, total: 120, tax: 20, order_type: "dine_in", created_at: "2026-09-01T12:00:00Z" },
      { id: 2, total: 60, tax: 10, order_type: "takeaway", created_at: "2026-09-01T13:00:00Z" },
    ],
    refunds: [{ order_id: 2, amount: 30, vat: 5, order_type: "takeaway", created_at: "2026-09-02T12:00:00Z" }],
    cardTaken: 100,
    platforms: [{ sales_date: "2026-09-01", platform: "deliveroo", orders: 10, sales: 240, commission: 60 }],
  };
  const p = buildPnl({
    from: "2026-09-01", to: "2026-09-30", vatRate: 0.2, sales,
    ingredients: 50, staff: 40, expenses: { total: 36, vatApplicableTotal: 24 }, recipe: { cogs: 30, coveragePct: 75 },
  });

  it("works out sales and VAT", () => {
    expect(p.sales).toEqual({
      own_gross: 180, refunds: 30, own: 150, platforms: 240, total: 390,
      vat_own: 25, vat_platforms: 40, vat: 65, ex_vat: 325,
    });
  });

  it("works out costs and profit ex-VAT", () => {
    expect(p.costs).toMatchObject({ ingredients: 50, staff: 40, expenses: 32, commission: 60, card_fees: 1.75, total: 183.75 });
    // No category split given: the whole amount shows as "Other expenses", and every line is listed.
    expect(p.costs.expense_lines.map((l) => l.key)).toEqual(["rent", "utilities", "marketing", "equipment", "professional_fees", "other"]);
    expect(p.costs.expense_lines.find((l) => l.key === "other")?.amount).toBe(32);
    expect(p.profit).toBe(141.25);
  });

  it("VAT return figures agree with the P&L", () => {
    expect(p.vat).toEqual({ output: 65, vat_applicable_expenses: 24, input: 4, net_due: 61 });
  });

  it("recipe basis swaps purchases for recipe cost", () => {
    expect(p.recipe).toEqual({ cogs: 30, coverage_pct: 75, profit: 161.25 });
  });

  it("is all zero with no data", () => {
    const z = buildPnl({
      from: "2026-09-01", to: "2026-09-01", vatRate: 0.2, sales: { orders: [], refunds: [], cardTaken: 0, platforms: [] },
      ingredients: 0, staff: 0, expenses: { total: 0, vatApplicableTotal: 0 }, recipe: { cogs: 0, coveragePct: 0 },
    });
    expect(z.profit).toBe(0);
    expect(z.vat.net_due).toBe(0);
  });
});

describe("recipeUsage", () => {
  // Curry: recipe makes 2 portions from 1 kg chicken (£6/kg) → 0.5 kg, £3 a portion.
  const book: RecipeBook = new Map([[10, { recipeId: 1, perPortion: [{ ingredient_id: 100, quantity: 0.5 }], costPerPortion: 3 }]]);

  it("uses and costs stock only for dishes with a recipe", () => {
    const r = recipeUsage(book, [
      { menu_item_id: 10, quantity: 3, item_price: 12 },   // costed: 36 revenue, £9 cost, 1.5 kg
      { menu_item_id: 11, quantity: 1, item_price: 4 },    // no recipe
      { menu_item_id: null, quantity: 1, item_price: 2 },  // custom item
    ]);
    expect(r.usage.get(100)).toBeCloseTo(1.5, 6);
    expect(r.cogs).toBeCloseTo(9, 6);
    expect(r.costedRevenue).toBe(36);
    expect(r.itemRevenue).toBe(42);
  });
});

describe("buildPnl expense categories", () => {
  it("lists every category, ex reclaimable VAT, adding up to the expenses total", () => {
      const split = buildPnl({
        from: "2026-09-01", to: "2026-09-30", vatRate: 0.2, sales: { orders: [], refunds: [], cardTaken: 0, platforms: [] },
        ingredients: 50, staff: 40, expenses: { total: 36, vatApplicableTotal: 24, byCategory: { rent: { total: 24, vatApplicableTotal: 24 }, other: { total: 12, vatApplicableTotal: 0 } } }, recipe: { cogs: 30, coveragePct: 75 },
      });
    const lines = Object.fromEntries(split.costs.expense_lines.map((l) => [l.key, l.amount]));
    expect(lines).toEqual({ rent: 20, utilities: 0, marketing: 0, equipment: 0, professional_fees: 0, other: 12 });
    expect(split.costs.expense_lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(split.costs.expenses, 2);
  });
});
