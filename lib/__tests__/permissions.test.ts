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
  it("Super admin sees every area", () => {
    for (const t of ["attendance", "hr", "menu", "tables", "inventory", "website", "finance", "analytics", "reports", "audit", "settings", "till", "drivers", "customers", "daily_accounts", "delivery_platforms"] as const) {
      expect(canAccess("admin", t)).toBe(true);
    }
  });

  it("Front House has only the till; Kitchen nothing", () => {
    expect(canAccess("employee", "till")).toBe(true);
    expect(canAccess("employee", "menu")).toBe(false);
    expect(canAccess("employee", "attendance")).toBe(false);
    expect(canAccess("employee", "settings")).toBe(false);
    expect(canAccess("kitchen", "till")).toBe(false);
    expect(canAccess("kitchen", "menu")).toBe(false);
  });

  it("Manager: operations, attendance, customers, settings — no HR, no Insights", () => {
    for (const role of ["manager"] as const) {
      for (const t of ["menu", "tables", "inventory", "approve_stock_takes", "drivers", "delivery_platforms", "daily_accounts", "website", "till", "attendance", "customers", "settings"] as const) {
        expect(canAccess(role, t)).toBe(true);
      }
      for (const t of ["hr", "analytics", "reports", "finance", "audit"] as const) {
        expect(canAccess(role, t)).toBe(false);
      }
    }
  });

  it("HR: attendance, HR & Payroll, reports only", () => {
    expect(canAccess("hr", "attendance")).toBe(true);
    expect(canAccess("hr", "hr")).toBe(true);
    expect(canAccess("hr", "reports")).toBe(true);
    expect(canAccess("hr", "finance")).toBe(false);
    expect(canAccess("hr", "till")).toBe(false);
    expect(canAccess("hr", "menu")).toBe(false);
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
    expect(canManageFinance("hr")).toBe(false);
    expect(canManageFinance("manager")).toBe(false);
    expect(canManageInventory("hr")).toBe(false);
    expect(canManageInventory("manager")).toBe(true);
  });
});
