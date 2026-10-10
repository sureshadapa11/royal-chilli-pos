jest.mock("../supabase", () => ({ __esModule: true, default: {} }));

import { buildPnl, extractVat } from "@/lib/finance";
import { totalFigures, type FiguresTotal } from "@/lib/daily-figures";
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
  // Day-by-day sums for a period (lib/daily-figures.ts), worked by hand:
  //   sales: Z report 600 + platforms 240 + catering 60 = 900 → ex-VAT 750, VAT 150
  //   costs: stock 50 + expenses 32 (36, of which 24 VAT-applicable → 4 claimed back)
  //          + card fee 1.69 + till paid out 10 + wages 40 + commission 60 = 193.69
  //   profit 750 − 193.69 = 556.31; VAT due 150 − 4 = 146; recipe basis 556.31 + 50 − 30 = 576.31
  const figures: FiguresTotal = {
    total_sales: 900, ex_vat: 750, money_out: 193.69, net_total: 556.31, variance: null,
    sales: { till: 600, platforms: 240, catering: 60 },
    out: { stock: 50, expenses: 32, card_fee: 1.69, paid_out: 10, wages: 40, commission: 60 },
  };
  const p = buildPnl({
    from: "2026-09-01", to: "2026-09-30", vatRate: 0.2, figures,
    expenses: { total: 36, vatApplicableTotal: 24 }, recipe: { cogs: 30, coveragePct: 75 },
  });

  it("sales are Z report + platforms + catering, VAT is ÷ 1.2", () => {
    expect(p.sales).toEqual({ till: 600, platforms: 240, catering: 60, total: 900, vat: 150, ex_vat: 750 });
  });

  it("costs are every bit of money out; profit is ex-VAT sales less costs", () => {
    expect(p.costs).toMatchObject({ ingredients: 50, staff: 40, expenses: 32, commission: 60, card_fees: 1.69, paid_out: 10, total: 193.69 });
    // No category split given: the whole amount shows as "Other expenses", and every line is listed.
    expect(p.costs.expense_lines.map((l) => l.key)).toEqual(["rent", "utilities", "marketing", "equipment", "professional_fees", "other"]);
    expect(p.costs.expense_lines.find((l) => l.key === "other")?.amount).toBe(32);
    expect(p.profit).toBe(556.31);
  });

  it("VAT return figures agree with the P&L", () => {
    expect(p.vat).toEqual({ output: 150, vat_applicable_expenses: 24, input: 4, net_due: 146 });
  });

  it("recipe basis swaps purchases for recipe cost", () => {
    expect(p.recipe).toEqual({ cogs: 30, coverage_pct: 75, profit: 576.31 });
  });

  it("is all zero with no data", () => {
    const z = buildPnl({
      from: "2026-09-01", to: "2026-09-01", vatRate: 0.2, figures: totalFigures([]),
      expenses: { total: 0, vatApplicableTotal: 0 }, recipe: { cogs: 0, coveragePct: 0 },
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
        from: "2026-09-01", to: "2026-09-30", vatRate: 0.2,
        figures: { ...totalFigures([]), out: { stock: 50, expenses: 32, card_fee: 0, paid_out: 0, wages: 40, commission: 0 } },
        expenses: { total: 36, vatApplicableTotal: 24, byCategory: { rent: { total: 24, vatApplicableTotal: 24 }, other: { total: 12, vatApplicableTotal: 0 } } }, recipe: { cogs: 30, coveragePct: 75 },
      });
    const lines = Object.fromEntries(split.costs.expense_lines.map((l) => [l.key, l.amount]));
    expect(lines).toEqual({ rent: 20, utilities: 0, marketing: 0, equipment: 0, professional_fees: 0, other: 12 });
    expect(split.costs.expense_lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(split.costs.expenses, 2);
  });
});
