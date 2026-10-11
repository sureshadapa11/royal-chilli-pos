import { dayFigures, totalFigures, daysBetween, type DayInputs } from "@/lib/daily-figures";

const blank: DayInputs = {
  z_report: 0, card: 0, commission: 0, catering_paid: 0, just_eat: 0, deliveroo: 0, uber_eats: 0, hiest: 0,
  opening: null, closing: null, stock: 0, expenses: 0, paid_out: 0, wages: 0,
  cash: 0, bank_in: 0, cash_in: 0, cash_out: 0,
};

describe("daily figures", () => {
  it("Total sales = Z report + every platform + catering paid", () => {
    const f = dayFigures("2026-10-09", { ...blank, z_report: 1000, just_eat: 100, deliveroo: 50, uber_eats: 25, hiest: 5, catering_paid: 20 }, 0.2, 0.0169);
    expect(f.total_sales).toBe(1200);
    expect(f.ex_vat).toBe(1000); // ÷ 1.2, not − 20%
  });

  it("Money out adds all six parts; Net total = Ex-VAT − Money out", () => {
    const f = dayFigures("2026-10-09", {
      ...blank, z_report: 1200, card: 1000, stock: 150, expenses: 80, paid_out: 20, wages: 300, commission: 40,
    }, 0.2, 0.0169);
    expect(f.out).toEqual({ stock: 150, expenses: 80, card_fee: 16.9, paid_out: 20, wages: 300, commission: 40 });
    expect(f.money_out).toBe(606.9);
    expect(f.net_total).toBe(393.1);
  });

  it("Variance = cash counted − cash expected (the owner's example: £15.89 missing)", () => {
    // opening £100 + cash sales £35.89 → expected £135.89; counted £120
    const f = dayFigures("d", { ...blank, opening: 100, cash: 35.89, closing: 120 }, 0.2, 0.0169);
    expect(f.expected).toBe(135.89);
    expect(f.variance).toBe(-15.89);
  });

  it("money in, money out (link + till Cash Out) and bank in all move the expected cash", () => {
    // 200 + 265.40 cash + 100 in − 40 link out − 10 till cash out − 100 bank in = 415.40
    const f = dayFigures("d", { ...blank, opening: 200, cash: 265.4, cash_in: 100, cash_out: 40, paid_out: 10, bank_in: 100, closing: 415.4 }, 0.2, 0.0169);
    expect(f.expected).toBe(415.4);
    expect(f.variance).toBe(0);
  });

  it("no opening or nothing counted: can't say", () => {
    expect(dayFigures("d", { ...blank, closing: 120 }, 0.2, 0.0169).variance).toBeNull();
    expect(dayFigures("d", { ...blank, opening: 150 }, 0.2, 0.0169).variance).toBeNull();
  });

  it("a day with only costs (rent, wages) has a negative Net total", () => {
    const f = dayFigures("d", { ...blank, expenses: 2000, wages: 100 }, 0.2, 0.0169);
    expect(f.net_total).toBe(-2100);
  });

  it("month total adds up every column", () => {
    const a = dayFigures("a", { ...blank, z_report: 120, opening: 100, closing: 90, wages: 10 }, 0.2, 0.0169); // expected 100, counted 90
    const b = dayFigures("b", { ...blank, z_report: 240, card: 100, stock: 30 }, 0.2, 0.0169);
    const t = totalFigures([a, b]);
    expect(t.total_sales).toBe(360);
    expect(t.ex_vat).toBe(300);
    expect(t.out.card_fee).toBe(1.69);
    expect(t.money_out).toBe(41.69);
    expect(t.net_total).toBe(258.31);
    expect(t.variance).toBe(-10);
    expect(totalFigures([b]).variance).toBeNull();
  });

  it("lists every day of a month", () => {
    const d = daysBetween("2026-10-01", "2026-10-31");
    expect(d).toHaveLength(31);
    expect(d[30]).toBe("2026-10-31");
  });
});

describe("sales split", () => {
  it("till, platforms and catering add up to Total sales", () => {
    const f = dayFigures("d", { ...blank, z_report: 500, just_eat: 40, deliveroo: 30, uber_eats: 20, hiest: 10, catering_paid: 100 }, 0.2, 0.0169);
    expect(f.sales).toEqual({ till: 500, platforms: 100, catering: 100 });
    expect(f.total_sales).toBe(700);
    expect(totalFigures([f, f]).sales).toEqual({ till: 1000, platforms: 200, catering: 200 });
  });
});
