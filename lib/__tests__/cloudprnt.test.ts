// Ticket rendering for the CloudPRNT printer: which items a kitchen ticket
// lists, and the StarPRNT / plain-text encodings the printer receives.
type Item = { id: number; item_name: string; quantity: number; notes: string | null; status: string; modifiers: string[]; allergens?: string[] };
let printData: { order: Record<string, unknown>; items: Item[] } | null;

// Printed tickets carry the business's own header (lib/brand.ts) — The Royal Chilli here.
jest.mock("@/lib/brand", () => ({
  getBrand: async () => ({
    businessId: 1, name: "The Royal Chilli", address: "43 Kingsley Road, Hounslow TW3 1PA",
    fullAddress: "43 Kingsley Road, Hounslow, London, TW3 1PA", phone: "020 8797 3044", logoUrl: "/logo.png", tagline: "Dil Se Desi",
  }),
}));
jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { business_id: 1 }, error: null }) }) }) }) },
}));
jest.mock("@/lib/kot", () => ({ getOrderForPrint: jest.fn(async () => printData) }));
jest.mock("@/lib/receipt", () => ({ getOrderForReceipt: jest.fn(async () => null) }));
let zReport: unknown = null;
jest.mock("@/lib/z-report-db", () => ({ getZReport: jest.fn(async () => zReport) }));
let tableRound: number | null = null;
jest.mock("@/lib/kitchen-rounds", () => ({ roundNumberFor: jest.fn(async () => tableRound) }));

import { addressLines, buildTicket, encodeCp437, plainTableLabel, toPlainText, toStarPrnt, type PrintJob } from "@/lib/cloudprnt";

const item = (id: number, name: string, extra: Partial<Item> = {}): Item => ({
  id, item_name: name, quantity: 1, notes: null, status: "pending", modifiers: [], ...extra,
});

const baseOrder = {
  status: "sent_to_kitchen", order_type: "dine_in", table_number: "7", order_number: "RC-0142",
  created_at: "2026-09-26T13:32:00Z", scheduled_for: null, customer_name: null, customer_phone: null,
  customer_address: null, customer_postcode: null, notes: null, total: 20, amount_paid: 0,
};

const job = (extra: Partial<PrintJob> = {}): PrintJob => ({ id: 1, order_id: 5, work_period_id: null, kind: "kot", source: "qr", item_ids: null, ...extra });
const texts = (t: { text: string }[] | null) => (t ?? []).map((l) => l.text);

describe("buildTicket (kitchen)", () => {
  it("prints a dish's allergens under it, and nothing extra for dishes without", async () => {
    printData = { order: baseOrder, items: [item(1, "Korma", { allergens: ["nuts", "milk"] }), item(2, "Plain Rice", { allergens: [] })] };
    const lines = texts(await buildTicket(job()));
    expect(lines).toContain("   ALLERGENS: NUTS, MILK");
    expect(lines.filter((l) => l.includes("ALLERGENS"))).toHaveLength(1);
  });

  it("marks a table's later till round, but not its first", async () => {
    printData = { order: { ...baseOrder, table_id: 3 }, items: [item(1, "Gulab Jamun")] };
    tableRound = 3;
    expect(texts(await buildTicket(job({ source: "till" })))).toContain("ROUND 3 - ADDED ITEMS");
    tableRound = 1;
    expect(texts(await buildTicket(job({ source: "till" }))).some((l) => l.startsWith("ROUND"))).toBe(false);
    tableRound = null;
  });

  it("lists only the round's items and flags it as an add-on", async () => {
    printData = { order: baseOrder, items: [item(1, "Samosa"), item(2, "Chicken Tikka"), item(3, "Garlic Naan")] };
    const lines = texts(await buildTicket(job({ item_ids: [2, 3] })));
    expect(lines).toContain("*** QR ORDER ***");
    expect(lines).toContain("TABLE 7");
    expect(lines).toContain("+ ADDITIONAL ITEMS +");
    expect(lines).toContain("1x Chicken Tikka");
    expect(lines).not.toContain("1x Samosa");
  });

  it("shows the whole order without an add-on flag when item_ids is null", async () => {
    printData = { order: baseOrder, items: [item(1, "Samosa")] };
    const lines = texts(await buildTicket(job({ source: "till" })));
    expect(lines).toContain("*** TILL ***");
    expect(lines).not.toContain("+ ADDITIONAL ITEMS +");
  });

  it("highlights item notes and labels manual reprints", async () => {
    printData = { order: baseOrder, items: [item(1, "Korma", { notes: "no nuts - allergy" })] };
    const lines = texts(await buildTicket(job({ source: null })));
    expect(lines).toContain("*** REPRINT ***");
    expect(lines).toContain("   *** NO NUTS - ALLERGY ***");
  });

  it("prints nothing for a cancelled order", async () => {
    printData = { order: { ...baseOrder, status: "cancelled" }, items: [item(1, "Samosa")] };
    expect(await buildTicket(job())).toBeNull();
  });

  it("prints nothing when none of the round's items are left", async () => {
    printData = { order: baseOrder, items: [item(1, "Samosa")] };
    expect(await buildTicket(job({ item_ids: [99] }))).toBeNull();
  });

  it("shows the scheduled slot and what's still to pay on online orders, in London time", async () => {
    printData = {
      order: { ...baseOrder, order_type: "takeaway", table_number: null, scheduled_for: "2026-09-26T18:00:00Z", total: 25, amount_paid: 0 },
      items: [item(1, "Biryani")],
    };
    const lines = texts(await buildTicket(job({ source: "online" })));
    expect(lines).toContain("COLLECTION");
    expect(lines).toContain("FOR 19:00"); // BST = UTC+1
    expect(lines).toContain("TO PAY: £25.00");
  });
});

describe("encoders", () => {
  it("encodes £ as CP437 and swaps other non-ASCII characters", () => {
    expect(encodeCp437("£5")).toEqual([0x9c, 0x35]);
    expect(encodeCp437("café — ok")).toEqual([..."cafe - ok"].map((c) => c.charCodeAt(0)));
    expect(encodeCp437("T1 · T2")).toEqual([0x54, 0x31, 0x20, 0xfa, 0x20, 0x54, 0x32]);
    expect(plainTableLabel("T1 + T2 · 👨‍👩‍👧 Family dinner ")).toBe("T1 + T2 · Family dinner");
    expect(encodeCp437("🌶")).toEqual([0x3f]); // one "?" per emoji
  });

  it("wraps StarPRNT output with init, styles and a cut", () => {
    const bytes = Array.from(toStarPrnt([{ text: "HI", bold: true, size: "big", align: "center" }]));
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(bytes).toEqual(expect.arrayContaining([0x1b, 0x45])); // bold on
    const text = bytes.indexOf(0x48);
    expect(bytes.slice(text - 4, text)).toEqual([0x1b, 0x69, 1, 1]); // double size just before the text
    expect(bytes.slice(-3)).toEqual([0x1b, 0x64, 3]);
  });

  it("centres plain text", () => {
    expect(toPlainText([{ text: "HI", align: "center" }]).split("\n")[0]).toBe(" ".repeat(23) + "HI");
  });
});

describe("buildTicket (Z report)", () => {
  it("prints the shift's report lines, amounts right-aligned", async () => {
    const { computeZReport } = await import("@/lib/z-report");
    zReport = computeZReport({
      period: { id: 72, status: "closed", opened_at: "2026-09-07T12:22:00Z", closed_at: "2026-09-08T13:37:00Z", opening_cash: 77, closing_cash: 95, close_note: null },
      openedByName: "Hari", closedByName: "Hari",
      payments: [{ order_id: 1, method: "cash", amount: 18, tip_amount: 0 }],
      orders: [], paidOuts: [],
    });
    const lines = texts(await buildTicket(job({ kind: "zreport", order_id: null, work_period_id: 72, source: null })));
    expect(lines).toContain("Z Report 72");
    const total = lines.find((l) => l.startsWith("Total sales amount"))!;
    expect(total).toHaveLength(48);
    expect(total.endsWith("£18.00")).toBe(true);
  });

  it("lays out narrower for the browser fallback without cutting amounts", async () => {
    const t = await buildTicket(job({ kind: "zreport", order_id: null, work_period_id: 72, source: null }), 35);
    const lines = (t ?? []).filter((l) => l.size !== "big").map((l) => l.text);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(35);
    // Too long to share a line with its amount: full label, amount below.
    const i = lines.indexOf("Expected closing cash balance");
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ +£\d+\.\d\d$/);
  });

  it("heads the report with the big name and full address, extra-thick section headings and tall key totals", async () => {
    const t = (await buildTicket(job({ kind: "zreport", order_id: null, work_period_id: 72, source: null }), 35))!;
    expect(t[0]).toMatchObject({ text: "THE ROYAL CHILLI", size: "big" });
    expect(t.map((l) => l.text)).toEqual(expect.arrayContaining(["43 Kingsley Road, Hounslow, London,", "TW3 1PA", "020 8797 3044"]));
    expect(t.find((l) => l.text === "Sales and refunds")).toMatchObject({ bold: true, thick: true });
    expect(t.find((l) => l.text.startsWith("Total net sales"))).toMatchObject({ size: "tall" });
    expect(t.find((l) => l.text.startsWith("Number of sales"))?.size).toBeUndefined();
  });

  it("prints nothing for a shift that doesn't exist", async () => {
    zReport = null;
    expect(await buildTicket(job({ kind: "zreport", order_id: null, work_period_id: 999, source: null }))).toBeNull();
  });
});

describe("addressLines", () => {
  it("breaks the address after commas to fit the line", () => {
    expect(addressLines("43 Kingsley Road, Hounslow, London, TW3 1PA", 35)).toEqual(["43 Kingsley Road, Hounslow, London,", "TW3 1PA"]);
    expect(addressLines("43 Kingsley Road, Hounslow, London, TW3 1PA", 48)).toEqual(["43 Kingsley Road, Hounslow, London, TW3 1PA"]);
  });
});

describe("long lines wrap between words", () => {
  it("never splits a word when it can break at a space", async () => {
    const { wrapWords } = await import("@/lib/cloudprnt");
    expect(wrapWords("Discount (Loyalty reward: Welcome 20% off (dine-in))", 35)).toEqual([
      "Discount (Loyalty reward: Welcome",
      "20% off (dine-in))",
    ]);
    expect(wrapWords("Address: 12 High Street, Hounslow, TW3 1HE", 35)).toEqual(["Address: 12 High Street, Hounslow,", "TW3 1HE"]);
  });
  it("keeps the indent on continuation lines, and short lines alone", async () => {
    const { wrapWords } = await import("@/lib/cloudprnt");
    expect(wrapWords("   ** no onions, extra chilli and lemon on the side", 35)).toEqual([
      "   ** no onions, extra chilli and",
      "   lemon on the side",
    ]);
    expect(wrapWords("1x Garlic Naan", 35)).toEqual(["1x Garlic Naan"]);
  });
});
