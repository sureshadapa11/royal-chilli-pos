import { canChangeAccess, canGiveRole, isFrontLine, isManagerRole, roleLabel } from "../roles";
import { canAccess } from "../permissions";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: { from: () => ({ select: () => Promise.resolve({ data: null, error: new Error("no db in unit tests") }) }) },
}));

describe("roles", () => {
  it("shows the agreed names", () => {
    expect(roleLabel("admin")).toBe("Super admin");
    expect(roleLabel("employee")).toBe("Front House");
    expect(roleLabel("kitchen")).toBe("Kitchen");
  });

  it("never lets anyone give Super admin", () => {
    for (const actor of ["admin", "hr", "manager"]) expect(canGiveRole(actor, "admin")).toBe(false);
  });

  it("lets Super admin and HR give any of the four; Manager only Front House and Kitchen; nobody Supervisor", () => {
    for (const actor of ["admin", "hr"]) {
      for (const r of ["manager", "hr", "employee", "kitchen"]) expect(canGiveRole(actor, r)).toBe(true);
    }
    expect(canGiveRole("manager", "employee")).toBe(true);
    expect(canGiveRole("manager", "kitchen")).toBe(true);
    expect(canGiveRole("manager", "hr")).toBe(false);
    expect(canGiveRole("admin", "supervisor")).toBe(false);
    expect(canGiveRole("employee", "kitchen")).toBe(false);
    expect(canGiveRole("admin", "driver")).toBe(false);
    expect(canChangeAccess("manager")).toBe(false);
  });

  it("treats Manager as manager level and Kitchen as front line", () => {
    expect(isManagerRole("manager")).toBe(true);
    expect(isManagerRole("hr")).toBe(false);
    expect(isFrontLine("kitchen")).toBe(true);
    expect(isFrontLine("manager")).toBe(false);
  });

  it("gives Managers their tabs and keeps Kitchen out of the Staff Hub", () => {
    expect(canAccess("manager", "menu")).toBe(true);
    expect(canAccess("manager", "audit")).toBe(false);
    expect(canAccess("manager", "finance")).toBe(false);
    expect(canAccess("kitchen", "menu")).toBe(false);
    expect(canAccess("admin", "audit")).toBe(true);
  });
});
