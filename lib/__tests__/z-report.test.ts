// Z report figures (payment-based, like SumUp) and the line layout shared by
// the screen and the printer.
import { computeZReport, zReportLines, type ZOrder, type ZPayment, type ZPeriod } from "@/lib/z-report";

const period = (extra: Partial<ZPeriod> = {}): ZPeriod => ({
  id: 72,
  status: "closed",
  opened_at: "2026-09-07T12:22:00Z",
  closed_at: "2026-09-08T13:37:00Z",
  opening_cash: 77,
  closing_cash: 195.7,
  close_note: "Monday",
  ...extra,
});

const order = (id: number, extra: Partial<ZOrder> = {}): ZOrder => ({
  id,
  order_number: `RC-${id}`,
  work_period_id: 72,
  status: "paid",
  pay_later: false,
  total: 0,
  amount_paid: 0,
  discount: 0,
  customer_name: null,
  created_at: "2026-09-07T13:00:00Z",
  ...extra,
});

const pay = (order_id: number, method: string, amount: number, tip_amount = 0): ZPayment => ({ order_id, method, amount, tip_amount });

// The owner's template: 12 sales, £578.98 incl. £2.46 tips, 4 discounts
// (£19.89), Card £460.28 / Cash £118.70, £77 float counted to £195.70.
function templateShift() {
  const orders = Array.from({ length: 12 }, (_, i) => order(i + 1, { discount: [5, 5, 4.89, 5][i] ?? 0 }));
  const payments: ZPayment[] = [
    ...Array.from({ length: 8 }, (_, i) => pay(i + 1, "card", i === 0 ? 460.28 - 7 * 50 - 2.46 : 50, i === 0 ? 2.46 : 0)),
    ...Array.from({ length: 4 }, (_, i) => pay(i + 9, "cash", i === 0 ? 118.7 - 3 * 30 : 30)),
  ];
  return { period: period(), openedByName: "Hari Kammeni", closedByName: "Hari Kammeni", payments, orders, paidOuts: [] };
}

describe("computeZReport", () => {
  it("matches the template's figures", () => {
    const r = computeZReport(templateShift());
    expect(r.sales_count).toBe(12);
    expect(r.sales_total).toBe(578.98);
    expect(r.refunds_count).toBe(0);
    expect(r.net_sales).toBe(576.52); // tips (£2.46) are staff's, not sales
    expect(r.discount_count).toBe(4);
    expect(r.discount_total).toBe(19.89);
    expect(r.tips_total).toBe(2.46);
    expect(r.payments).toEqual({ card: 460.28, cash: 118.7, online: 0 });
    expect(r.cash).toEqual({ opening: 77, cash_in: 118.7, cash_out: 0, expected: 195.7, counted: 195.7, difference: 0 });
  });

  it("Card + Cash + Online always equals Total sales", () => {
    const r = computeZReport({
      ...templateShift(),
      payments: [pay(1, "card", 20, 2), pay(2, "cash", 15), pay(3, "card_online", 30.5)],
    });
    expect(r.payments.card + r.payments.cash + r.payments.online).toBeCloseTo(r.sales_total);
  });

  it("counts an earlier shift's Pay Later bill as a sale on the day it's paid", () => {
    const r = computeZReport({
      ...templateShift(),
      payments: [pay(1, "cash", 10), pay(99, "card", 40)],
      orders: [order(1), order(99, { work_period_id: 71, created_at: "2026-09-06T19:00:00Z" })],
    });
    expect(r.sales_count).toBe(2);
    expect(r.sales_total).toBe(50);
    expect(r.other.earlier_bills_paid).toEqual([{ order_number: "RC-99", order_date: "2026-09-06T19:00:00Z", amount: 40 }]);
  });

  it("takes refunds off net sales, and cash refunds and paid-outs out of the drawer", () => {
    const r = computeZReport({
      ...templateShift(),
      period: period({ closing_cash: 100 }),
      payments: [pay(1, "cash", 50), pay(2, "card", 30), pay(1, "cash", -10), pay(2, "card", -5)],
      paidOuts: [{ reason: "Driver", amount: 7 }],
    });
    expect(r.refunds_count).toBe(2);
    expect(r.refunds_total).toBe(15);
    expect(r.net_sales).toBe(65);
    expect(r.cash).toEqual({ opening: 77, cash_in: 50, cash_out: 17, expected: 110, counted: 100, difference: -10 });
  });

  it("lists unpaid Pay Later bills, and unresolved orders only while open", () => {
    const input = {
      ...templateShift(),
      payments: [],
      orders: [
        order(1, { status: "open", pay_later: true, total: 25, amount_paid: 5, customer_name: "Sam" }),
        order(2, { status: "sent_to_kitchen", total: 12 }),
        order(3, { status: "cancelled", total: 9 }),
      ],
    };
    const open = computeZReport({ ...input, period: period({ status: "open", closed_at: null }) });
    expect(open.other.pending_bills).toEqual([{ order_number: "RC-1", customer_name: "Sam", balance: 20 }]);
    expect(open.other.unresolved).toEqual([{ order_number: "RC-2", balance: 12 }]);
    expect(open.cash.counted).toBeNull();
    expect(computeZReport(input).other.unresolved).toEqual([]);
  });

  it("never blocks Close Day on an online-paid order still in the kitchen, or a refunded one", () => {
    const r = computeZReport({
      ...templateShift(),
      period: period({ status: "open", closed_at: null }),
      payments: [
        { order_id: 5, method: "card_online", amount: 3.45, tip_amount: 0 },
        { order_id: 5, method: "card_online", amount: -3.45, tip_amount: 0 },
      ],
      orders: [
        order(4, { status: "ready", total: 10, amount_paid: 10 }),
        order(5, { status: "ready", total: 3.45, amount_paid: 0, pay_later: true }),
      ],
    });
    expect(r.other.unresolved).toEqual([]);
    expect(r.other.pending_bills).toEqual([]);
  });
});

describe("zReportLines", () => {
  const rows = (lines: ReturnType<typeof zReportLines>) =>
    Object.fromEntries(lines.flatMap((l) => (l.kind === "row" ? [[l.label, l.value]] : [])));

  it("lays the report out like the template", () => {
    const lines = zReportLines(computeZReport(templateShift()));
    expect(lines[0]).toEqual({ kind: "title", text: "Z Report 72" });
    const r = rows(lines);
    expect(r["Opened"]).toBe("07 Sept 2026 13:22");
    expect(r["Closed"]).toBe("08 Sept 2026 14:37");
    expect(r["Total sales amount"]).toBe("£578.98");
    expect(r["Total discount amount"]).toBe("-£19.89");
    expect(r["Expected closing cash balance"]).toBe("£195.70");
    expect(r["Difference"]).toBe("£0.00");
    expect(lines).toContainEqual({ kind: "text", text: "By Hari Kammeni" });
    expect(lines).toContainEqual({ kind: "text", text: "Monday" });
    expect(r["Online"]).toBeUndefined();
    expect(lines.some((l) => l.kind === "heading" && l.text === "Other")).toBe(false);
  });

  it("shows an open shift as an X report, with the count being typed in", () => {
    const report = computeZReport({ ...templateShift(), period: period({ status: "open", closed_at: null, close_note: null }) });
    const lines = zReportLines(report, 190);
    expect(lines[0]).toEqual({ kind: "title", text: "X Report 72 (not closed)" });
    const r = rows(lines);
    expect(r["Closed"]).toBe("Not closed yet");
    expect(r["Counted closing cash balance"]).toBe("£190.00");
    expect(r["Difference"]).toBe("-£5.70");
  });
});

describe("bills closed at £0", () => {
  it("count as a sale with their reward on the Loyalty line, adding £0 to takings", () => {
    const r = computeZReport({
      period: period(), openedByName: null, closedByName: null, paidOuts: [],
      orders: [
        order(1, { total: 20, amount_paid: 20 }),
        order(2, { total: 0, amount_paid: 0, loyalty_discount: 2.95 }), // voucher covered it all
      ],
      payments: [{ order_id: 1, method: "cash", amount: 20, tip_amount: 0 }],
    });
    expect(r.sales_count).toBe(2);
    expect(r.sales_total).toBe(20);
    expect(r.loyalty_count).toBe(1);
    expect(r.loyalty_total).toBe(2.95);
  });
});

describe("a table bill paid in one go", () => {
  it("counts its rounds as ONE sale (the other rounds' payments say 'Bill #…')", () => {
    const r = computeZReport({
      period: period(), openedByName: null, closedByName: null, paidOuts: [],
      orders: [
        order(249, { total: 5.28, amount_paid: 5.28, loyalty_discount: 5 }),
        order(250, { total: 10.57, amount_paid: 10.57 }),
        order(251, { total: 12, amount_paid: 12 }),
      ],
      payments: [
        { order_id: 249, method: "cash", amount: 5.28, tip_amount: 0, reference: null },
        { order_id: 250, method: "cash", amount: 10.57, tip_amount: 0, reference: "Bill #249" },
        { order_id: 251, method: "card", amount: 12, tip_amount: 0, reference: null },
      ],
    });
    expect(r.sales_count).toBe(2); // the table bill + another bill
    expect(r.sales_total).toBe(27.85);
    expect(r.loyalty_count).toBe(1);
  });
});
