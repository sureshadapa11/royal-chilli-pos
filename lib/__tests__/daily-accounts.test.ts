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
