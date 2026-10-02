// Exercises the hardcoded DEFAULTS fallback in lib/permissions.ts — there's no
// live Supabase in a unit test, so the role_permissions cache stays empty and
// canAccess() falls back to the built-in matrix. The DB-backed grant/revoke
// path is verified against the real database.
jest.mock("../supabase", () => ({
  __esModule: true,
  default: {
    from: () => ({
      select: () => Promise.resolve({ data: null, error: new Error("no db in unit tests") }),
    }),
  },
}));

import { canAccess, isStaffManagement, canManageFinance, canManageInventory } from "@/lib/permissions";

describe("canAccess — default matrix", () => {
  it("admin sees every tab", () => {
    for (const t of ["attendance", "hr", "menu", "tables", "inventory", "website", "finance", "analytics", "reports", "audit", "settings"] as const) {
      expect(canAccess("admin", t)).toBe(true);
    }
  });

  it("employee sees no tab", () => {
    expect(canAccess("employee", "menu")).toBe(false);
    expect(canAccess("employee", "attendance")).toBe(false);
    expect(canAccess("employee", "settings")).toBe(false);
    expect(canAccess("employee", "website")).toBe(false);
  });

  it("manager: operations + attendance/finance/reports, not hr/audit/settings", () => {
    expect(canAccess("manager", "menu")).toBe(true);
    expect(canAccess("manager", "tables")).toBe(true);
    expect(canAccess("manager", "inventory")).toBe(true);
    expect(canAccess("manager", "website")).toBe(true);
    expect(canAccess("manager", "attendance")).toBe(true);
    expect(canAccess("manager", "finance")).toBe(true);
    expect(canAccess("manager", "reports")).toBe(true);
    expect(canAccess("manager", "hr")).toBe(false);
    expect(canAccess("manager", "audit")).toBe(false);
    expect(canAccess("manager", "settings")).toBe(false);
  });

  it("hr: attendance, hr, finance, reports only", () => {
    expect(canAccess("hr", "attendance")).toBe(true);
    expect(canAccess("hr", "hr")).toBe(true);
    expect(canAccess("hr", "finance")).toBe(true);
    expect(canAccess("hr", "reports")).toBe(true);
    expect(canAccess("hr", "menu")).toBe(false);
    expect(canAccess("hr", "inventory")).toBe(false);
    expect(canAccess("hr", "website")).toBe(false);
    expect(canAccess("hr", "analytics")).toBe(false);
    expect(canAccess("hr", "settings")).toBe(false);
  });
});

describe("helpers", () => {
  it("isStaffManagement excludes employee", () => {
    expect(isStaffManagement("employee")).toBe(false);
    expect(isStaffManagement("manager")).toBe(true);
    expect(isStaffManagement("hr")).toBe(true);
    expect(isStaffManagement("admin")).toBe(true);
  });

  it("legacy shims map to tabs", () => {
    expect(canManageFinance("hr")).toBe(true);
    expect(canManageInventory("hr")).toBe(false);
    expect(canManageInventory("manager")).toBe(true);
  });
});
