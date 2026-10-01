const mockWrites: { table: string; values: unknown }[] = [];
let ingredientReadCount = 0;

const mockQueryState = {
  from(table: string) {
    const builder: Record<string, any> = {};
    const ingredientRead = table === "ingredients" ? ++ingredientReadCount : 0;
    let inserted: unknown;
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.neq = () => builder;
    builder.limit = () => builder;
    builder.in = () => builder;
    builder.insert = (values: unknown) => {
      inserted = values;
      mockWrites.push({ table, values });
      return builder;
    };
    builder.maybeSingle = async () => ({ data: { business_id: 1, location_id: 2 }, error: null });
    builder.then = (resolve: (value: { data: unknown; error: null }) => void) => {
      let data: unknown = [];
      if (table === "order_items") data = [{ menu_item_id: 20, quantity: 1 }];
      if (table === "ingredients") {
        data = ingredientRead === 1
          ? [{ id: 101, name: "Tomatoes", unit: "kg", location_id: 1 }]
          : [{ id: 202, name: "Tomatoes", unit: "kg", location_id: 2 }];
      }
      if (table === "stock_movements" && inserted) data = null;
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return builder;
  },
};

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: { from: (table: string) => mockQueryState.from(table) },
}));
jest.mock("@/lib/business-db", () => ({
  bizDb: jest.fn(() => ({ from: (table: string) => mockQueryState.from(table) })),
}));
jest.mock("@/lib/recipes", () => ({
  loadRecipeBook: jest.fn(async () => new Map()),
  recipeUsage: jest.fn(() => ({ usage: new Map([[101, 2]]), cogs: 0, costedRevenue: 0, itemRevenue: 0 })),
}));

import { depleteStockForOrder } from "@/lib/inventory";

describe("depleteStockForOrder location", () => {
  beforeEach(() => {
    mockWrites.length = 0;
    ingredientReadCount = 0;
  });

  it("deducts from the order location's matching ingredient", async () => {
    await depleteStockForOrder(45, 4);

    expect(mockWrites).toContainEqual({
      table: "stock_movements",
      values: [expect.objectContaining({
        ingredient_id: 202,
        location_id: 2,
        quantity_delta: -2,
        reference_type: "order",
        reference_id: 45,
      })],
    });
  });
});
