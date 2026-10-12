import { canSeeSalary, salaryRow } from "@/lib/salary-sheet";

const base = { staffId: 1, name: "Anusha", role: "employee", hours: 0, payRate: 0, paid: 0, given: 0, repaid: 0, deducted: 0, owedToDate: 0 };

describe("salary sheet", () => {
  it("wages = hours (to the minute) × pay rate; balance = wages − paid − advance owed", () => {
    const r = salaryRow({ ...base, hours: 40 + 30 / 60, payRate: 12, paid: 100, given: 50, owedToDate: 50 });
    expect(r.wages).toBe(486);
    expect(r.balance).toBe(336);
    expect(r.advanceOwed).toBe(50);
  });
  it("never shows a negative balance", () => {
    expect(salaryRow({ ...base, hours: 2, payRate: 10, paid: 50 }).balance).toBe(0);
  });
  it("is for Super admin, HR and Supervisor only", () => {
    expect(canSeeSalary({ role: "admin" })).toBe(true);
    expect(canSeeSalary({ role: "hr" })).toBe(true);
    expect(canSeeSalary({ role: "supervisor" })).toBe(true);
    expect(canSeeSalary({ role: "manager" })).toBe(false);
    expect(canSeeSalary({ role: "manager", owner: true })).toBe(true);
  });
});
