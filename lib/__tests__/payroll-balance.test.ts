import { balanceToPay } from "@/lib/payroll-balance";
import { CASH_CATEGORIES } from "@/lib/cash-categories";

describe("payslip balance to pay", () => {
  it("takes off wages already paid in cash, then the advance owed", () => {
    expect(balanceToPay(500, 100, 50, true)).toEqual({ advance_deducted: 50, balance: 350 });
  });
  it("leaves the advance when told not to take it off", () => {
    expect(balanceToPay(500, 100, 50, false)).toEqual({ advance_deducted: 0, balance: 400 });
  });
  it("never takes off more advance than is left to pay", () => {
    expect(balanceToPay(200, 150, 80, true)).toEqual({ advance_deducted: 50, balance: 0 });
  });
});

describe("cash categories each have one home", () => {
  it("expense categories name the expense they create; picks and photos make sense", () => {
    for (const c of CASH_CATEGORIES) {
      if (c.home === "expense") expect(c.expenseCategory).toBeTruthy();
      if (c.home === "wages" || c.home === "advance") expect(c.pick).toBe("staff");
      if (c.home === "supplier") expect(c.pick).toBe("supplier");
      if (c.direction === "in") expect(c.photo).toBe(false);
    }
    expect(new Set(CASH_CATEGORIES.map((c) => c.key)).size).toBe(CASH_CATEGORIES.length);
  });
});
