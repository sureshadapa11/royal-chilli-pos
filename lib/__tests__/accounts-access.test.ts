jest.mock("@/lib/supabase", () => ({ __esModule: true, default: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) } }));
import { accountsAccess } from "@/lib/accounts-access";

describe("who sees what in Daily accounts", () => {
  it("Super admin: every tab, enters, corrects and deletes", () => {
    const a = accountsAccess({ role: "admin" });
    expect(a.tabs).toEqual(["day", "month", "cash", "book", "salary"]);
    expect([a.canEnter, a.canCorrect, a.canDelete, a.seeFigures]).toEqual([true, true, true, true]);
    expect(accountsAccess({ role: "manager", owner: true }).canCorrect).toBe(true);
  });
  it("Supervisor: every tab, view only", () => {
    const a = accountsAccess({ role: "supervisor" });
    expect(a.tabs).toEqual(["day", "month", "cash", "book", "salary"]);
    expect([a.canEnter, a.canCorrect, a.canDelete, a.seeFigures]).toEqual([false, false, false, true]);
  });
  it("HR: the Salary tab only", () => {
    expect(accountsAccess({ role: "hr" })).toMatchObject({ tabs: ["salary"], canEnter: false, seeFigures: false });
  });
  it("Manager: the Day tab only, entry, no figures", () => {
    const a = accountsAccess({ role: "manager" });
    expect(a.tabs).toEqual(["day"]);
    expect([a.canEnter, a.canCorrect, a.canDelete, a.seeFigures]).toEqual([true, false, false, false]);
  });
  it("Front House / Kitchen / Bar: nothing (they use the staff links)", () => {
    for (const role of ["employee", "kitchen", "bar"]) expect(accountsAccess({ role }).tabs).toEqual([]);
  });
});
