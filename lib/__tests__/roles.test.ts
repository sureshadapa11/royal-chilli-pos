import { canChangeAccess, canGiveRole, isFrontLine, isManagerRole, roleLabel, isTillOnly, NOT_ON_ROTA } from "@/lib/roles";
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

  it("lets Super admin and HR give any role but Super admin; Manager / Supervisor only Front House, Bar and Kitchen", () => {
    for (const actor of ["admin", "hr"]) {
      for (const r of ["supervisor", "manager", "hr", "employee", "bar", "kitchen"]) expect(canGiveRole(actor, r)).toBe(true);
      expect(canGiveRole(actor, "admin")).toBe(false);
    }
    for (const actor of ["manager", "supervisor"]) {
      for (const r of ["employee", "bar", "kitchen"]) expect(canGiveRole(actor, r)).toBe(true);
      for (const r of ["supervisor", "manager", "hr"]) expect(canGiveRole(actor, r)).toBe(false);
    }
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

  it("Supervisor is manager level and off the rota; Bar is till only and on the rota", () => {
    expect(isManagerRole("supervisor")).toBe(true);
    expect(isFrontLine("bar")).toBe(true);
    expect(isTillOnly("bar")).toBe(true);
    expect(isTillOnly("employee")).toBe(true);
    expect(isTillOnly("kitchen")).toBe(false);
    expect(NOT_ON_ROTA).toContain("supervisor");
    expect(NOT_ON_ROTA).not.toContain("bar");
  });

  it("gives Managers their tabs and keeps Kitchen out of the Staff Hub", () => {
    expect(canAccess("manager", "menu")).toBe(true);
    expect(canAccess("manager", "audit")).toBe(false);
    expect(canAccess("manager", "hr")).toBe(false);
    expect(canAccess("kitchen", "menu")).toBe(false);
    expect(canAccess("admin", "audit")).toBe(true);
  });
});
