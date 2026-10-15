import { SHEET_COLUMNS, sheetCell, sheetTotal } from "@/lib/sheet-columns";
import type { DayFigures, FiguresTotal } from "@/lib/daily-figures";
import type { DailyRow } from "@/lib/daily-accounts";

// Owed columns (agreed 2026-10-15): what's still owed at the end of each day.
const day = (date: string, owed: { bills?: number; catering?: number; events?: number }) =>
  ({ date, pending_owed: owed.bills ?? 0, catering_owed: owed.catering ?? 0, events_owed: owed.events ?? 0 }) as unknown as DayFigures;
const ft = { out: { commission: 0, card_fee: 0 }, sales: { catering: 0, events: 0 } } as unknown as FiguresTotal;

describe("month sheet owed columns", () => {
  it("puts Pending bills first, and an unpaid column after Catering paid and Events paid", () => {
    const keys = SHEET_COLUMNS.map((c) => c.key);
    expect(keys[0]).toBe("bills_owed");
    expect(keys.slice(keys.indexOf("catering_paid"), keys.indexOf("catering_paid") + 4)).toEqual(["catering_paid", "catering_unpaid", "events_paid", "events_unpaid"]);
    expect(keys).toContain("pending");
    expect(keys).not.toContain("catering_pending");
  });

  it("Pending is bills + catering unpaid + events unpaid", () => {
    const f = day("2026-10-07", { bills: 50, catering: 810, events: 200 });
    expect(sheetCell("bills_owed", undefined, f)).toBe(50);
    expect(sheetCell("catering_unpaid", undefined, f)).toBe(810);
    expect(sheetCell("events_unpaid", undefined, f)).toBe(200);
    expect(sheetCell("pending", undefined, f)).toBe(1060);
  });

  it("counts an old typed Pending / Catering pending figure too", () => {
    const r = { trading_date: "2026-10-03", pending: 20, catering_pending: 30 } as unknown as DailyRow;
    expect(sheetCell("catering_unpaid", r, day("2026-10-03", {}))).toBe(30);
    expect(sheetCell("pending", r, day("2026-10-03", {}))).toBe(50);
  });

  it("a part payment brings it down; paid in full leaves it blank", () => {
    expect(sheetCell("catering_unpaid", undefined, day("2026-10-08", { catering: 810 }))).toBe(810);
    expect(sheetCell("catering_unpaid", undefined, day("2026-10-10", { catering: 0 }))).toBeNull();
    expect(sheetCell("pending", undefined, day("2026-10-10", {}))).toBeNull();
  });

  it("the month figure is the latest day reached, not a sum", () => {
    const days = [day("2026-10-07", { catering: 810 }), day("2026-10-08", { catering: 810 }), day("2026-10-09", { catering: 300, bills: 20 }), day("2026-10-20", { catering: 999 })];
    expect(sheetTotal("catering_unpaid", {}, ft, [], days, "2026-10-09")).toBe(300);
    expect(sheetTotal("bills_owed", {}, ft, [], days, "2026-10-09")).toBe(20);
    expect(sheetTotal("pending", {}, ft, [], days, "2026-10-09")).toBe(320);
  });
});
