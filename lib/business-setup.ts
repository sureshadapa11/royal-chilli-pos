// The Business setup page (Staff Hub → Settings → Business setup): which
// details each section holds, who may change them, and what a valid value
// looks like. Safe in the browser (no database imports) — the page and the
// API route share these rules. Data lives in `businesses` and, for the
// owner-only bank details / payment keys, `business_private` (migration 080).

export type SectionKey = "details" | "addresses" | "tax" | "bank" | "receipts" | "modules" | "payments" | "legal";
export type FieldKind = "text" | "email" | "url" | "phone" | "textarea" | "address" | "bool" | "rate" | "colour";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  required?: boolean;
  /** Returns an error message, or null when the value is fine. Empty values are fine unless required. */
  check?: (v: string) => string | null;
};

export type SectionDef = {
  key: SectionKey;
  title: string;
  about: string;
  /** Only the group owner may change (and, for "bank" / "payments", see) this section. */
  ownerOnly: boolean;
  /** Stored in business_private rather than businesses. */
  private?: boolean;
  fields: FieldDef[];
};

const trimmed = (v: string) => v.trim();

// ── UK formats ───────────────────────────────────────────────────────────────
export const checks = {
  email: (v: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed(v)) ? null : "Enter a valid email address"),
  url: (v: string) => (/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(trimmed(v)) ? null : "Start with https:// (e.g. https://www.melthouse.co.uk)"),
  phone: (v: string) => (/^\+?[\d\s()-]{10,16}$/.test(trimmed(v)) ? null : "Enter a UK phone number"),
  companyNumber: (v: string) => (/^([0-9]{8}|[A-Z]{2}[0-9]{6})$/i.test(trimmed(v).replace(/\s/g, "")) ? null : "8 characters, e.g. 12345678 or SC123456"),
  vatNumber: (v: string) => (/^(GB)?([0-9]{9}|[0-9]{12})$/i.test(trimmed(v).replace(/\s/g, "")) ? null : "GB followed by 9 digits, e.g. GB123456789"),
  utr: (v: string) => (/^[0-9]{10}$/.test(trimmed(v).replace(/\s/g, "")) ? null : "10 digits"),
  paye: (v: string) => (/^[0-9]{3}\/?[A-Z0-9]{1,10}$/i.test(trimmed(v).replace(/\s/g, "")) ? null : "e.g. 123/AB45678"),
  yearEnd: (v: string) => {
    const m = /^(\d{2})-(\d{2})$/.exec(trimmed(v));
    if (!m) return "DD-MM, e.g. 31-03";
    const [d, mo] = [Number(m[1]), Number(m[2])];
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= days ? null : "Not a real date";
  },
  sortCode: (v: string) => (/^[0-9]{6}$/.test(trimmed(v).replace(/[\s-]/g, "")) ? null : "6 digits, e.g. 12-34-56"),
  accountNumber: (v: string) => (/^[0-9]{8}$/.test(trimmed(v).replace(/\s/g, "")) ? null : "8 digits"),
  iban: (v: string) => (/^GB[0-9]{2}[A-Z]{4}[0-9]{14}$/i.test(trimmed(v).replace(/\s/g, "")) ? null : "A UK IBAN: GB, 2 digits, 4 letters, 14 digits"),
  swift: (v: string) => (/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(trimmed(v)) ? null : "8 or 11 characters"),
  prefix: (v: string) => (/^[A-Z]{1,4}$/.test(trimmed(v)) ? null : "1–4 capital letters, e.g. MH"),
  loginCode: (v: string) => (/^[A-Z0-9]{2,8}$/.test(trimmed(v).toUpperCase()) ? null : "2–8 letters or numbers, e.g. MH"),
  colour: (v: string) => (/^#[0-9a-f]{6}$/i.test(trimmed(v)) ? null : "A colour like #E34435"),
  postcode: (v: string) => (/^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i.test(trimmed(v)) ? null : "A UK postcode, e.g. TW3 1PA"),
  rate: (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 0.25 ? null : "Between 0 and 0.25 (20% = 0.20)";
  },
  domain: (v: string) => {
    const t = trimmed(v).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(t) ? null : "Enter a domain like melthouse.co.uk";
  },
  stripeSecret: (v: string) => (/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(trimmed(v)) ? null : "Starts sk_live_ (or sk_test_)"),
  stripePublishable: (v: string) => (/^pk_(live|test)_[A-Za-z0-9]{10,}$/.test(trimmed(v)) ? null : "Starts pk_live_ (or pk_test_)"),
  stripeWebhook: (v: string) => (/^whsec_[A-Za-z0-9]{10,}$/.test(trimmed(v)) ? null : "Starts whsec_"),
  sumupKey: (v: string) => (/^sup_sk_[A-Za-z0-9]{10,}$/.test(trimmed(v)) ? null : "Starts sup_sk_"),
  merchantCode: (v: string) => (/^[A-Z0-9]{6,12}$/i.test(trimmed(v)) ? null : "Your SumUp merchant code, e.g. MCRNF79M"),
};

/** Keys whose value is a secret: only ever written (encrypted), never read back to the page. */
export const SECRET_FIELDS = new Set(["stripe_secret_key", "stripe_webhook_secret", "sumup_api_key"]);

export const MODULES: { key: string; label: string }[] = [
  { key: "till", label: "Till" },
  { key: "kitchen_display", label: "Kitchen Display" },
  { key: "tables", label: "Tables" },
  { key: "qr_ordering", label: "QR ordering at the table" },
  { key: "website", label: "Website" },
  { key: "online_ordering", label: "Online ordering" },
  { key: "delivery", label: "Delivery" },
  { key: "reservations", label: "Table bookings" },
  { key: "inventory", label: "Stock & recipes" },
  { key: "rewards", label: "Rewards club" },
  { key: "food_safety", label: "Food safety records" },
  { key: "delivery_platforms", label: "Delivery platforms (Just Eat, Uber Eats, Deliveroo)" },
];

export const SECTIONS: SectionDef[] = [
  {
    key: "details", title: "Business details", ownerOnly: false,
    about: "How the business is named and reached. The trading name shows on the till, receipts and website.",
    fields: [
      { key: "name", label: "Trading name", kind: "text", required: true },
      { key: "tagline", label: "Tagline", kind: "text", hint: "Short line under the name on the till and Staff Hub, e.g. Dil Se Desi" },
      { key: "legal_name", label: "Legal company name", kind: "text", hint: "As registered at Companies House, e.g. Melt House Ltd" },
      { key: "company_number", label: "Company number", kind: "text", check: checks.companyNumber },
      { key: "phone", label: "Phone", kind: "phone", check: checks.phone },
      { key: "email", label: "Email", kind: "email", check: checks.email },
      { key: "website", label: "Website", kind: "url", check: checks.url },
      { key: "login_code", label: "Business code (staff sign-in)", kind: "text", required: true, hint: "Managers type this at crewportal.vercel.app/staff, e.g. MH", check: checks.loginCode },
      { key: "custom_domain", label: "Custom domain", kind: "text", hint: "e.g. melthouse.co.uk or www.melthouse.co.uk", check: checks.domain },
      { key: "logo_url", label: "Logo (image address)", kind: "text", hint: "Square image works best. Leave empty to show the business's initials." },
      { key: "brand_colour", label: "Brand colour", kind: "colour", check: checks.colour },
    ],
  },
  {
    key: "addresses", title: "Addresses", ownerOnly: false,
    about: "The trading address prints on receipts. The registered office is for the accountant export.",
    fields: [
      { key: "trading_address", label: "Trading address", kind: "address" },
      { key: "registered_address", label: "Registered office address", kind: "address" },
    ],
  },
  {
    key: "tax", title: "Tax & VAT", ownerOnly: true,
    about: "The VAT number prints on receipts when the business is VAT registered.",
    fields: [
      { key: "vat_registered", label: "VAT registered", kind: "bool" },
      { key: "vat_number", label: "VAT number", kind: "text", check: checks.vatNumber },
      { key: "vat_rate", label: "VAT rate on food", kind: "rate", hint: "0.20 for 20%", check: checks.rate },
      { key: "vat_scheme", label: "VAT scheme", kind: "text", hint: "e.g. Standard, Flat Rate, Cash Accounting" },
      { key: "utr", label: "Company UTR", kind: "text", check: checks.utr },
      { key: "paye_reference", label: "PAYE reference", kind: "text", check: checks.paye },
      { key: "year_end", label: "Financial year end", kind: "text", hint: "DD-MM, e.g. 31-03", check: checks.yearEnd },
    ],
  },
  {
    key: "bank", title: "Accountant & bank", ownerOnly: true, private: true,
    about: "For the monthly accountant export. Only the owner can see these.",
    fields: [
      { key: "bank_name", label: "Bank", kind: "text" },
      { key: "account_name", label: "Account name", kind: "text" },
      { key: "sort_code", label: "Sort code", kind: "text", check: checks.sortCode },
      { key: "account_number", label: "Account number", kind: "text", check: checks.accountNumber },
      { key: "iban", label: "IBAN", kind: "text", check: checks.iban },
      { key: "swift_bic", label: "SWIFT / BIC", kind: "text", check: checks.swift },
    ],
  },
  {
    key: "receipts", title: "Receipts & numbering", ownerOnly: false,
    about: "Extra lines printed at the top and bottom of receipts, and the start of order and purchase-order numbers.",
    fields: [
      { key: "receipt_header", label: "Receipt header", kind: "textarea", hint: "Printed under the business name" },
      { key: "receipt_footer", label: "Receipt footer", kind: "textarea", hint: "e.g. Thank you — see you soon!" },
      { key: "order_prefix", label: "Order number prefix", kind: "text", required: true, hint: "RC-20260929-001", check: checks.prefix },
      { key: "po_prefix", label: "Purchase order prefix", kind: "text", required: true, check: checks.prefix },
      { key: "accounts_email", label: "Accounts email", kind: "email", hint: "Where the accountant export goes", check: checks.email },
    ],
  },
  {
    key: "modules", title: "Modules", ownerOnly: true,
    about: "Which parts of the system this business uses. Switched-off parts are hidden from its staff.",
    fields: MODULES.map((m) => ({ key: `modules.${m.key}`, label: m.label, kind: "bool" as const })),
  },
  {
    key: "payments", title: "Payments", ownerOnly: true, private: true,
    about: "This company's own Stripe (website payments) and SumUp (card reader) accounts. Keys are stored encrypted and never shown again — only whether each is connected.",
    fields: [
      { key: "stripe_publishable_key", label: "Stripe publishable key", kind: "text", check: checks.stripePublishable },
      { key: "stripe_secret_key", label: "Stripe secret key", kind: "text", check: checks.stripeSecret },
      { key: "stripe_webhook_secret", label: "Stripe webhook signing secret", kind: "text", check: checks.stripeWebhook },
      { key: "sumup_merchant_code", label: "SumUp merchant code", kind: "text", check: checks.merchantCode },
      { key: "sumup_api_key", label: "SumUp API key", kind: "text", check: checks.sumupKey },
    ],
  },
  {
    key: "legal", title: "Website legal pages", ownerOnly: false,
    about: "Shown on this business's own website. Have your solicitor check the wording.",
    fields: [
      { key: "privacy_policy", label: "Privacy policy", kind: "textarea" },
      { key: "terms", label: "Terms & conditions", kind: "textarea" },
      { key: "refund_policy", label: "Refund policy", kind: "textarea" },
    ],
  },
];

export type Address = { line1?: string; line2?: string; city?: string; county?: string; postcode?: string };

/** One line for receipts: "43 Kingsley Road, Hounslow TW3 1PA". */
export function addressOneLine(a: Address | null | undefined): string {
  if (!a) return "";
  const town = [a.city, a.postcode].filter(Boolean).join(" ");
  return [a.line1, a.line2, town].filter((p) => p && String(p).trim()).join(", ");
}

/**
 * Validate one section's submitted values. Returns field → error message
 * (empty object = all fine). Unknown fields are reported too.
 */
export function validateSection(section: SectionDef, values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const known = new Map(section.fields.map((f) => [f.key, f]));
  for (const [key, raw] of Object.entries(values)) {
    const f = known.get(key);
    if (!f) { errors[key] = "Unknown field"; continue; }
    if (f.kind === "bool") { if (typeof raw !== "boolean") errors[key] = "Yes or no"; continue; }
    if (f.kind === "address") {
      const a = (raw ?? {}) as Address;
      if (typeof a !== "object") { errors[key] = "Invalid address"; continue; }
      if (a.postcode && checks.postcode(String(a.postcode))) errors[key] = checks.postcode(String(a.postcode))!;
      continue;
    }
    const v = raw == null ? "" : String(raw);
    if (!v.trim()) { if (f.required) errors[key] = `${f.label} is required`; continue; }
    const err = f.check?.(v);
    if (err) errors[key] = err;
  }
  return errors;
}
