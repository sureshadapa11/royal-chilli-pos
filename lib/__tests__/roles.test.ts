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
    expect(roleLabel("supervisor")).toBe("Supervisor");
  });

  it("never lets anyone give Super admin", () => {
    for (const actor of ["admin", "supervisor", "hr", "manager"]) expect(canGiveRole(actor, "admin")).toBe(false);
  });

  it("lets Super admin, Supervisor and HR give any of the five; Manager only Front House and Kitchen", () => {
    for (const actor of ["admin", "supervisor", "hr"]) {
      for (const r of ["supervisor", "manager", "hr", "employee", "kitchen"]) expect(canGiveRole(actor, r)).toBe(true);
    }
    expect(canGiveRole("manager", "employee")).toBe(true);
    expect(canGiveRole("manager", "kitchen")).toBe(true);
    expect(canGiveRole("manager", "hr")).toBe(false);
    expect(canGiveRole("manager", "supervisor")).toBe(false);
    expect(canGiveRole("employee", "kitchen")).toBe(false);
    expect(canGiveRole("admin", "driver")).toBe(false);
    expect(canChangeAccess("manager")).toBe(false);
  });

  it("treats Supervisor as manager level and Kitchen as front line", () => {
    expect(isManagerRole("supervisor")).toBe(true);
    expect(isManagerRole("hr")).toBe(false);
    expect(isFrontLine("kitchen")).toBe(true);
    expect(isFrontLine("supervisor")).toBe(false);
  });

  it("starts Supervisor with the Manager's tabs and keeps Kitchen out of the Staff Hub", () => {
    expect(canAccess("supervisor", "menu")).toBe(true);
    expect(canAccess("supervisor", "audit")).toBe(false);
    expect(canAccess("supervisor", "finance")).toBe(false);
    expect(canAccess("kitchen", "menu")).toBe(false);
    expect(canAccess("admin", "audit")).toBe(true);
  });
});
