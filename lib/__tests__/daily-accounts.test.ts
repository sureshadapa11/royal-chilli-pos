import { fromZReports } from "@/lib/daily-accounts";
import type { ZReport } from "@/lib/z-report";

const z = (over: { net: number; card: number; cash: number; opening: number; counted: number | null; expected: number; pending: number[] }) =>
  ({
    net_sales: over.net,
    payments: { card: over.card, cash: over.cash, online: 0 },
    cash: { opening: over.opening, cash_in: 0, cash_out: 0, expected: over.expected, counted: over.counted, difference: null },
    other: { pending_bills: over.pending.map((b, i) => ({ order_number: `P${i}`, customer_name: null, balance: b })), earlier_bills_paid: [], paid_outs: [], refunds: [], unresolved: [] },
  }) as unknown as ZReport;

describe("daily accounts from the Z report", () => {
  it("is empty when no shift was opened that day", () => {
    expect(fromZReports([])).toEqual({});
  });

  it("takes one shift's figures", () => {
    expect(fromZReports([z({ net: 480.5, card: 300, cash: 180.5, opening: 150, counted: 330.5, expected: 330.5, pending: [12, 8.25] })])).toEqual({
      z_report: 480.5, card: 300, cash: 180.5, pending: 20.25, opening_balance: 150, closing_balance: 330.5,
    });
  });

  it("adds up several shifts: first opening, last closing (counted, else expected)", () => {
    const v = fromZReports([
      z({ net: 100, card: 60, cash: 40, opening: 150, counted: 190, expected: 190, pending: [] }),
      z({ net: 200, card: 150, cash: 50, opening: 190, counted: null, expected: 240, pending: [5] }),
    ]);
    expect(v).toEqual({ z_report: 300, card: 210, cash: 90, pending: 5, opening_balance: 150, closing_balance: 240 });
  });
});

import { columnTotals, summarise, type DailyRow } from "@/lib/daily-accounts";

const row = (d: string, v: Partial<DailyRow>, status: "draft" | "submitted" = "submitted"): DailyRow =>
  ({ trading_date: d, notes: null, status, ...v }) as DailyRow;

describe("month total and the dashboard Summary", () => {
  const rows = [
    row("2026-10-01", { cash: "100.00", bank_in: "80.00", pending: "10", catering_paid: 50, catering_pending: 20, opening_balance: "150", closing_balance: "170" }),
    row("2026-10-02", { cash: 60.5, bank_in: null, pending: 0, opening_balance: 170, closing_balance: 230.5 }, "draft"),
    row("2026-10-04", { cash: 40, bank_in: 100, closing_balance: 130 }),
  ];

  it("adds up each column on its own (strings from the database too); untouched columns stay blank", () => {
    const t = columnTotals(rows);
    expect(t).toMatchObject({ cash: 200.5, bank_in: 180, pending: 10, catering_paid: 50, catering_pending: 20 });
    expect(t.z_report).toBeNull();
  });

  it("summarises a period: not banked, first opening → last closing, and days submitted so far", () => {
    const s = summarise(rows, "2026-10-01", "2026-10-07", "2026-10-04");
    expect(s).toMatchObject({
      bankIn: 180, cash: 200.5, notBanked: 20.5, pending: 10, cateringPaid: 50, cateringPending: 20,
      opening: 150, closing: 130, submitted: 2, daysSoFar: 4,
    });
    // 2nd is only a draft, 3rd wasn't entered; days after today don't count.
    expect(s.missing).toEqual(["2026-10-02", "2026-10-03"]);
  });

  it("shows no balances when no day has them", () => {
    expect(summarise([], "2026-10-01", "2026-10-01", "2026-10-01")).toMatchObject({ opening: null, closing: null, submitted: 0, daysSoFar: 1, missing: ["2026-10-01"] });
  });
});
