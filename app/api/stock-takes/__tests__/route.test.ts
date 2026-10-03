import { NextRequest } from "next/server";

const mockSession = { id: 4, name: "Manager", role: "manager", businessId: 1 };
const mockWrites: { table: string; values: unknown }[] = [];
const mockFilters: string[] = [];
const mockDb = {
  from(table: string) {
    const builder: Record<string, any> = {};
    let inserted: unknown;
    builder.insert = (values: unknown) => {
      inserted = values;
      mockWrites.push({ table, values });
      return builder;
    };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.or = (filter: string) => {
      mockFilters.push(filter);
      return builder;
    };
    builder.order = () => builder;
    builder.single = async () => ({ data: { id: 9, location_id: 3, ...(inserted as object) }, error: null });
    builder.then = (resolve: (value: { data: unknown; error: null }) => void) =>
      Promise.resolve({
        data: table === "ingredients" ? [{ id: 12, current_stock: 20 }] : null,
        error: null,
      }).then(resolve);
    return builder;
  },
};

jest.mock("@/lib/auth", () => ({
  getSessionFromRequest: jest.fn(async () => mockSession),
}));
jest.mock("@/lib/permissions", () => ({
  canManageInventory: jest.fn(() => true),
  areaAllows: jest.fn(() => true),
}));
jest.mock("@/lib/business-db", () => ({
  bizDb: jest.fn(() => mockDb),
}));
jest.mock("@/lib/locations", () => ({
  resolveInventoryLocation: jest.fn(async () => ({ locationId: 3 })),
}));

import { POST } from "@/app/api/stock-takes/route";

describe("POST /api/stock-takes location snapshot", () => {
  beforeEach(() => {
    mockWrites.length = 0;
    mockFilters.length = 0;
  });

  it("creates the take and snapshots location-specific and shared ingredients", async () => {
    const req = new NextRequest("http://localhost/api/stock-takes", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mockWrites).toContainEqual({
      table: "stock_takes",
      values: { location_id: 3, counted_by: 4 },
    });
    expect(mockFilters).toContain("location_id.eq.3,location_id.is.null");
    expect(mockWrites).toContainEqual({
      table: "stock_take_lines",
      values: [{ stock_take_id: 9, ingredient_id: 12, system_qty: 20 }],
    });
  });
});
