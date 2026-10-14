import { buildSafeBook, buildCashBook, type DayInput } from "@/lib/cash-book";

const day = (date: string, extra: Partial<DayInput> = {}): DayInput => ({ date, dayEnd: null, moves: [], tillOut: [], ...extra });

describe("cash book", () => {
  it("runs a balance through the day and checks it against the count (the £15.89 example)", () => {
    const [d] = buildCashBook([day("2026-10-11", { dayEnd: { opening: 100, cash: 35.89, bankIn: null, closing: 120, by: "Anusha" } })], null);
    expect(d.lines.map((l) => l.balance)).toEqual([100, 135.89]);
    expect(d.expected).toBe(135.89);
    expect(d.variance).toBe(-15.89);
    expect(d.carry).toBe(120);
  });

  it("till cash in / out and till cash out move the balance; the count comes before the cash taken to the Safe (136)", () => {
    const [d] = buildCashBook([day("d", {
      dayEnd: { opening: 200, cash: 265.4, bankIn: 100, closing: 515.4, by: "Anusha" },
      moves: [{ direction: "in", amount: 100, label: "Catering", by: "Ramesh" }, { direction: "out", amount: 40, label: "Ingredients", by: "Ramesh" }],
      tillOut: [{ amount: 10, reason: "Milk", by: "Vijay" }],
    })], null);
    expect(d.lines.map((l) => l.kind)).toEqual(["opening", "sales", "in", "out", "till_out", "bank"]);
    expect(d.expected).toBe(515.4);
    expect(d.variance).toBe(0);
    expect(d.carry).toBe(415.4); // what's left in the till after £100 went to the Safe
  });

  it("the next day starts from the count; a different typed opening is flagged", () => {
    const [, b] = buildCashBook([
      day("a", { dayEnd: { opening: 100, cash: 50, bankIn: null, closing: 150, by: null } }),
      day("b", { dayEnd: { opening: 140, cash: 0, bankIn: null, closing: 140, by: null } }),
    ], null);
    expect(b.opening).toBe(140);
    expect(b.openingDiff).toBe(-10);
  });

  it("a day without a Day End carries the balance and says so", () => {
    const [, b, c] = buildCashBook([
      day("a", { dayEnd: { opening: 100, cash: 20, bankIn: null, closing: 120, by: null } }),
      day("b", { moves: [{ direction: "out", amount: 5, label: "Milk", by: null }] }),
      day("c", { dayEnd: { opening: null, cash: 10, bankIn: null, closing: 125, by: null } }),
    ], null);
    expect(b.entered).toBe(false);
    expect(b.opening).toBe(120);
    expect(b.carry).toBe(115);
    expect(c.opening).toBe(115);
    expect(c.variance).toBe(0);
  });
});


describe("safe (136)", () => {
  it("takings, money in and out give a running balance; a count shows the difference", () => {
    const b = buildSafeBook([
      { date: "2026-10-01", kind: "takings", label: "Takings from till", by: null, amount: 53.74 },
      { date: "2026-10-07", kind: "in", label: "Owner put cash in", by: "Hari", amount: 1000 },
      { date: "2026-10-07", kind: "out", label: "Wages", by: "Suresh", amount: 600 },
    ], [{ date: "2026-10-07", amount: 450, by: "Hari", note: null }], "2026-10-01");
    expect(b.balance).toBe(453.74);
    expect(b.totalIn).toBe(1053.74);
    expect(b.totalOut).toBe(600);
    expect(b.lastCount).toEqual({ date: "2026-10-07", counted: 450, difference: -3.74 });
    expect(b.lines.at(-1)?.kind).toBe("count");
  });
  it("brings forward what came before the month", () => {
    const b = buildSafeBook([{ date: "2026-09-30", kind: "in", label: "x", by: null, amount: 100 }, { date: "2026-10-02", kind: "out", label: "y", by: null, amount: 30 }], [], "2026-10-01");
    expect(b.opening).toBe(100);
    expect(b.balance).toBe(70);
    expect(b.lines).toHaveLength(1);
  });
});
