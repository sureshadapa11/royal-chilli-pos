import { buildCashBook, type DayInput } from "@/lib/cash-book";

const day = (date: string, extra: Partial<DayInput> = {}): DayInput => ({ date, dayEnd: null, moves: [], tillOut: [], ...extra });

describe("cash book", () => {
  it("runs a balance through the day and checks it against the count (the £15.89 example)", () => {
    const [d] = buildCashBook([day("2026-10-11", { dayEnd: { opening: 100, cash: 35.89, bankIn: null, closing: 120, by: "Anusha" } })], null);
    expect(d.lines.map((l) => l.balance)).toEqual([100, 135.89]);
    expect(d.expected).toBe(135.89);
    expect(d.variance).toBe(-15.89);
    expect(d.carry).toBe(120);
  });

  it("cash in / out, till cash out and bank in each move the balance", () => {
    const [d] = buildCashBook([day("d", {
      dayEnd: { opening: 200, cash: 265.4, bankIn: 100, closing: 415.4, by: "Anusha" },
      moves: [{ direction: "in", amount: 100, label: "Catering", by: "Ramesh" }, { direction: "out", amount: 40, label: "Ingredients", by: "Ramesh" }],
      tillOut: [{ amount: 10, reason: "Milk", by: "Vijay" }],
    })], null);
    expect(d.lines.map((l) => l.kind)).toEqual(["opening", "sales", "in", "out", "till_out", "bank"]);
    expect(d.expected).toBe(415.4);
    expect(d.variance).toBe(0);
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
