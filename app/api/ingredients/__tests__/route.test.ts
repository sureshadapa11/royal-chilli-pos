import { NextRequest } from "next/server";

const mockSession = { id: 4, name: "Manager", role: "manager", businessId: 1 };
const mockWrites: { table: string; values: unknown }[] = [];
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
    builder.single = async () => ({
      data: table === "ingredients" && inserted
        ? { id: 12, ...(inserted as object) }
        : { id: 12, name: "Tomatoes", unit: "kg", current_stock: 0 },
      error: null,
    });
    builder.then = (resolve: (value: { data: null; error: null }) => void) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
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
  allOwned: jest.fn(async () => true),
}));
jest.mock("@/lib/locations", () => ({
  resolveInventoryLocation: jest.fn(async () => ({ locationId: 2 })),
}));
jest.mock("@/lib/unique-entry", () => ({
  findActiveByName: jest.fn(async () => null),
}));

import { POST } from "@/app/api/ingredients/route";

describe("POST /api/ingredients location assignment", () => {
  beforeEach(() => {
    mockWrites.length = 0;
  });

  it("assigns the new ingredient and opening stock movement to the staff location", async () => {
    const req = new NextRequest("http://localhost/api/ingredients", {
      method: "POST",
      body: JSON.stringify({ name: "Tomatoes", unit: "kg", opening_stock: 5 }),
    });

    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mockWrites).toContainEqual({
      table: "ingredients",
      values: expect.objectContaining({ name: "Tomatoes", location_id: 2 }),
    });
    expect(mockWrites).toContainEqual({
      table: "stock_movements",
      values: expect.objectContaining({ ingredient_id: 12, location_id: 2, quantity_delta: 5 }),
    });
  });
});
