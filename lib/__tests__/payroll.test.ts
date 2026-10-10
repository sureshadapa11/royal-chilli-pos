let attendanceRows: Record<string, unknown>[];
let businessFilter: unknown;

jest.mock("../supabase", () => ({
  __esModule: true,
  default: {
    from: () => ({
      select: () => ({
        // bizDb adds the business filter first
        eq: (_c: string, v: unknown) => { businessFilter = v; return {
        not: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data: attendanceRows, error: null }),
          }),
        }),
        }; },
      }),
    }),
  },
}));

import { payslipTotals, computeGrossPay, computeHoursForPeriod } from "@/lib/payroll";

describe("computeGrossPay", () => {
  it("adds bonuses, tips and holiday pay, and subtracts deductions", () => {
    expect(computeGrossPay({ base_pay: 200, bonuses: 20, tips: 15, deductions: 10, holiday_pay: 0 })).toBe(225);
  });

  it("rounds to the nearest penny", () => {
    expect(computeGrossPay({ base_pay: 100.005, bonuses: 0, tips: 0, deductions: 0, holiday_pay: 0 })).toBe(100.01);
  });

  it("handles an all-zero entry", () => {
    expect(computeGrossPay({ base_pay: 0, bonuses: 0, tips: 0, deductions: 0, holiday_pay: 0 })).toBe(0);
  });
});

describe("computeHoursForPeriod", () => {
  beforeEach(() => {
    attendanceRows = [];
  });

  it("converts net_work_seconds to hours per staff member", async () => {
    attendanceRows = [{ staff_id: 1, net_work_seconds: 3600 * 8 }];
    const hours = await computeHoursForPeriod(1, "2026-01-01", "2026-01-07");
    expect(hours.get(1)).toBe(8);
  });

  it("sums multiple shifts for the same staff member across the period", async () => {
    attendanceRows = [
      { staff_id: 1, net_work_seconds: 3600 * 8 },
      { staff_id: 1, net_work_seconds: 3600 * 6 },
      { staff_id: 2, net_work_seconds: 3600 * 5 },
    ];
    const hours = await computeHoursForPeriod(1, "2026-01-01", "2026-01-07");
    expect(hours.get(1)).toBe(14);
    expect(hours.get(2)).toBe(5);
  });

  it("returns an empty map when nobody worked in the period", async () => {
    const hours = await computeHoursForPeriod(1, "2026-01-01", "2026-01-07");
    expect(hours.size).toBe(0);
  });

  it("only counts shifts worked at the business being paid", async () => {
    await computeHoursForPeriod(2, "2026-01-01", "2026-01-07");
    expect(businessFilter).toBe(2);
  });
});

describe("payslipTotals", () => {
  const day = (date: string, seconds: number) => ({ date, clock_in: `${date}T10:00:00Z`, clock_out: `${date}T20:00:00Z`, seconds });
  it("adds exact minutes and pays hours × rate", () => {
    // 9h 49m + 7h 30m = 17h 19m = 17.3167h × £11.44 = £198.10
    const p = payslipTotals([day("2026-10-09", 9 * 3600 + 49 * 60), day("2026-10-10", 7.5 * 3600)], 11.44);
    expect(p.total_seconds).toBe(17 * 3600 + 19 * 60);
    expect(p.hours_worked).toBe(17.32);
    expect(p.total_amount).toBe(198.1);
  });
  it("no pay rate means £0", () => {
    expect(payslipTotals([day("2026-10-09", 3600)], 0).total_amount).toBe(0);
  });
});
