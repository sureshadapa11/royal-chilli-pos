import { SECTIONS, addressOneLine, checks, validateSection } from "@/lib/business-setup";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const section = (k: string) => SECTIONS.find((s) => s.key === k)!;

describe("UK formats on the Business setup page", () => {
  it("accepts real-looking UK details", () => {
    expect(checks.vatNumber("GB 123 4567 89")).toBeNull();
    expect(checks.companyNumber("12345678")).toBeNull();
    expect(checks.companyNumber("SC123456")).toBeNull();
    expect(checks.sortCode("12-34-56")).toBeNull();
    expect(checks.postcode("TW3 1PA")).toBeNull();
    expect(checks.yearEnd("31-03")).toBeNull();
    expect(checks.iban("GB29 NWBK 6016 1331 9268 19")).toBeNull();
    expect(checks.domain("melthouse.co.uk")).toBeNull();
    expect(checks.domain("www.melthouse.co.uk")).toBeNull();
    expect(checks.domain("https://order.melthouse.co.uk")).toBeNull();
  });
  it("refuses wrong ones with a message saying what's expected", () => {
    expect(checks.vatNumber("12345")).toMatch(/GB followed by 9 digits/);
    expect(checks.sortCode("1234")).toMatch(/6 digits/);
    expect(checks.yearEnd("31-02")).toMatch(/Not a real date/);
    expect(checks.postcode("12345")).toMatch(/UK postcode/);
    expect(checks.prefix("mh")).toMatch(/capital letters/);
    expect(checks.domain("not a domain")).toMatch(/Enter a domain/);
  });
  it("validates a whole section, allowing empty optional fields", () => {
    expect(validateSection(section("tax"), { vat_number: "", utr: "12345" })).toEqual({ utr: "10 digits" });
    expect(validateSection(section("receipts"), { order_prefix: "" })).toEqual({ order_prefix: "Order number prefix is required" });
    expect(validateSection(section("details"), { hacked: "x" })).toEqual({ hacked: "Unknown field" });
  });
  it("prints the trading address on one line", () => {
    expect(addressOneLine({ line1: "45 Kingsley Road", city: "Hounslow", postcode: "TW3 1PA" })).toBe("45 Kingsley Road, Hounslow TW3 1PA");
  });
});

describe("payment keys are encrypted", () => {
  const OLD = process.env.SETTINGS_ENCRYPTION_KEY;
  beforeAll(() => { process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); });
  afterAll(() => { process.env.SETTINGS_ENCRYPTION_KEY = OLD; });

  it("never stores the key in readable form, and reads back the same key", () => {
    const stored = encryptSecret("sk_live_abcdefghijklmnop");
    expect(stored).not.toContain("sk_live");
    expect(decryptSecret(stored)).toBe("sk_live_abcdefghijklmnop");
  });
  it("a tampered value is refused", () => {
    const [v, iv, tag, data] = encryptSecret("sk_live_abcdefghijklmnop").split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });
});
