import { dayEndText, whatsAppUrl } from "@/lib/day-end-text";
import type { DayEndReport } from "@/lib/day-end-report";

// A consistent example: opening £100 + cash £35.89 − £45 cash out = £90.89 expected, £120 counted → +£29.11.
const report = (extra: Partial<DayEndReport> = {}): DayEndReport => ({
  businessId: 1, business: "The Royal Chilli", date: "2026-10-11",
  entered: { by: "Anusha", via: "link" },
  figures: {
    z_report: 1245.6, card: 980.2, cash: 35.89, tips: 0,
    platforms: [{ label: "Just Eat", sales: 312.5, commission: 43.75 }, { label: "Deliveroo", sales: null, commission: null }],
    catering_paid: null, catering_pending: null, total_sales: 1558.1, net_total: 1100, fees: 60.32,
    ex_vat: 1298.42, sales_vat: 259.68, vat_claimed: 5.81, vat_to_pay: 253.87,
  },
  notes: null,
  drawer: { opening: 100, cashSales: 35.89, moneyIn: 0, moneyOut: 45, bankIn: 0, expected: 90.89, counted: 120, variance: 29.11 },
  cash: [{ direction: "out", category: "Ingredients / stock (cash buy)", method: "Cash", amount: 45, reason: "Veg", paidTo: null, by: "Ramesh" }],
  missingDays: ["2026-10-09", "2026-10-11"],
  ...extra,
});

describe("WhatsApp day report (style A)", () => {
  it("has the headline, sales lines, the lined-up cash block and the entries", () => {
    const t = dayEndText(report());
    expect(t).toContain("🌶️ *THE ROYAL CHILLI*");
    expect(t).toContain("💷 *SALES  £1,558.10*");
    expect(t).toContain("› 🛵 Just Eat  £312.50");
    expect(t).not.toContain("Deliveroo");
    expect(t).toContain("💸 Commission & fees  £60.32");
    expect(t).toContain("   🧾 VAT (20%)  £259.68 · Ex-VAT £1,298.42");
    expect(t).toContain("🏛️ VAT to pay (today)  £253.87 _(claimed back £5.81)_");
    expect(t).toContain("− Money out".padEnd(13) + "£45.00".padStart(11));
    expect(t).toContain("= Expected".padEnd(13) + "£90.89".padStart(11));
    expect(t).toContain("🟠 *Variance +£29.11 (extra)*");
    expect(t).toContain("🔴 −£45.00 · 💵 Cash");
    expect(t).toContain("_Ingredients / stock (cash buy) · Veg_ — Ramesh");
    expect(t).toContain("⚠️ *Day End missing:* Fri 9 Oct");
    expect(t).toContain("✍️ Entered by Anusha");
  });
  it("colours the variance: green when right, red when missing", () => {
    expect(dayEndText(report({ drawer: { ...report().drawer, variance: 0 } }))).toContain("🟢 *Variance £0.00 (all correct)*");
    expect(dayEndText(report({ drawer: { ...report().drawer, variance: -15.89 } }))).toContain("🔴 *Variance −£15.89 (missing)*");
  });
  it("says when the Day End wasn't entered", () => {
    expect(dayEndText(report({ figures: null, entered: null }))).toContain("⚠️ *Day End not entered*");
  });
  it("links to WhatsApp with the text (to a number if given)", () => {
    expect(whatsAppUrl("Hi & bye", "+44 7700 900123")).toBe("https://api.whatsapp.com/send?phone=447700900123&text=Hi%20%26%20bye");
    expect(whatsAppUrl("x")).toBe("https://api.whatsapp.com/send?text=x");
    // emojis go through as proper UTF-8 (wa.me's redirect broke them)
    expect(whatsAppUrl("🌶️")).toBe("https://api.whatsapp.com/send?text=%F0%9F%8C%B6%EF%B8%8F");
  });
});
