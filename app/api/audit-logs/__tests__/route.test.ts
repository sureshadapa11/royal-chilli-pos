import { NextRequest } from "next/server";

let mockEqCalls: [string, unknown][] = [];
let mockSession: { id: number; name: string; role: string; businessId: number } | null = {
  id: 8,
  name: "A Manager",
  role: "manager",
  businessId: 2,
};

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (field: string, value: unknown) => {
        mockEqCalls.push([field, value]);
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () => Promise.resolve({ data: [], error: null });
      return builder;
    },
  },
}));
jest.mock("@/lib/auth", () => ({
  getSessionFromRequest: jest.fn(() => Promise.resolve(mockSession)),
}));
jest.mock("@/lib/permissions", () => ({ canManageStaff: () => true, areaAllows: () => true }));

import { GET } from "@/app/api/audit-logs/route";

beforeEach(() => {
  mockEqCalls = [];
  mockSession = { id: 8, name: "A Manager", role: "manager", businessId: 2 };
});

describe("GET /api/audit-logs", () => {
  it("returns only audit rows for the session business", async () => {
    const response = await GET(new NextRequest("https://pos.example/api/audit-logs"));

    expect(response.status).toBe(200);
    expect(mockEqCalls).toContainEqual(["business_id", 2]);
  });

  it("keeps the existing unauthorized response without a session", async () => {
    mockSession = null;

    const response = await GET(new NextRequest("https://pos.example/api/audit-logs"));

    expect(response.status).toBe(401);
    expect(mockEqCalls).toHaveLength(0);
  });
});
