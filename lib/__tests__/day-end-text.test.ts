import { dayEndText, whatsAppUrl } from "@/lib/day-end-text";
import type { DayEndReport } from "@/lib/day-end-report";

const report = (extra: Partial<DayEndReport> = {}): DayEndReport => ({
  businessId: 1, business: "The Royal Chilli", date: "2026-10-11",
  entered: { by: "Anusha", via: "link" },
  figures: {
    z_report: 1245.6, card: 980.2, cash: 35.89, tips: 0,
    platforms: [{ label: "Just Eat", sales: 312.5, commission: 43.75 }, { label: "Deliveroo", sales: null, commission: null }],
    catering_paid: null, catering_pending: null, total_sales: 1558.1, net_total: 1100,
  },
  notes: null,
  drawer: { opening: 100, cashSales: 35.89, moneyIn: 0, moneyOut: 0, bankIn: 0, expected: 135.89, counted: 120, variance: -15.89 },
  cash: [{ direction: "out", category: "Ingredients / stock (cash buy)", method: "Cash", amount: 45, reason: "Veg", paidTo: null, by: "Ramesh" }],
  missingDays: ["2026-10-09", "2026-10-11"],
  ...extra,
});

describe("WhatsApp day report", () => {
  it("has the headline figures, the cash check and the entries", () => {
    const t = dayEndText(report());
    expect(t).toContain("*The Royal Chilli – Daily Report*");
    expect(t).toContain("Just Eat £312.50 (comm £43.75)");
    expect(t).not.toContain("Deliveroo");
    expect(t).toContain("*Variance −£15.89* ⚠️ missing");
    expect(t).toContain("OUT £45.00 · Cash · Ingredients / stock (cash buy): Veg (Ramesh)");
    expect(t).toContain("⚠️ Day End also missing: Fri 9 Oct");
  });
  it("says when the Day End wasn't entered", () => {
    expect(dayEndText(report({ figures: null, entered: null }))).toContain("⚠️ *Day End not entered*");
  });
  it("links to WhatsApp with the text (to a number if given)", () => {
    expect(whatsAppUrl("Hi & bye", "+44 7700 900123")).toBe("https://wa.me/447700900123?text=Hi%20%26%20bye");
    expect(whatsAppUrl("x")).toBe("https://wa.me/?text=x");
  });
});
