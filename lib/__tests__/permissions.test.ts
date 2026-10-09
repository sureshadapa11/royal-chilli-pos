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

import { canAccess, canEdit, levelOf, areaAllows, manageAllows, isStaffManagement, canManageFinance, canManageInventory, canManageCrm, canViewCrm } from "@/lib/permissions";

describe("canAccess — default matrix", () => {
  it("Super admin sees every area", () => {
    for (const t of ["attendance", "hr", "menu", "tables", "inventory", "website", "finance", "analytics", "reports", "audit", "settings", "till", "drivers", "customers", "daily_accounts"] as const) {
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

  it("Manager: full on the day-to-day areas, view only on Customers and Insights, no HR or Audit log", () => {
    for (const t of ["menu", "tables", "inventory", "approve_stock_takes", "drivers", "daily_accounts", "website", "till", "attendance", "settings"] as const) {
      expect(levelOf("manager", t)).toBe("full");
    }
    for (const t of ["customers", "analytics", "reports", "finance"] as const) {
      expect(levelOf("manager", t)).toBe("view");
      expect(canAccess("manager", t)).toBe(true);
      expect(canEdit("manager", t)).toBe(false);
      expect(areaAllows("manager", t, "GET")).toBe(true);
      expect(areaAllows("manager", t, "POST")).toBe(false);
    }
    for (const t of ["hr", "audit"] as const) expect(canAccess("manager", t)).toBe(false);
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
    expect(canManageFinance("manager")).toBe(true); // view
    expect(canViewCrm("manager")).toBe(true);
    expect(canManageCrm("manager")).toBe(false);
    // Shared data: any management role reads it, changing needs full.
    expect(manageAllows("hr", "menu", "GET")).toBe(true);
    expect(manageAllows("hr", "menu", "PATCH")).toBe(false);
    expect(manageAllows("manager", "menu", "PATCH")).toBe(true);
    expect(canManageInventory("hr")).toBe(false);
    expect(canManageInventory("manager")).toBe(true);
  });
});
