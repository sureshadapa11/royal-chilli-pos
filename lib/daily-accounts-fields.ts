// The day-end accounts sheet's columns, in the paper sheet's order. `auto`
// fields are pre-filled from the till (still editable); the rest are typed in
// by the manager. Safe to import in the browser.
export const DAILY_FIELDS = [
  { key: "z_report", label: "Z report", auto: true, hint: "Net sales on the till's Z report (tips not included)" },
  { key: "card", label: "Card", auto: true, hint: "Card taken on the till" },
  { key: "cash", label: "Cash", auto: true, hint: "Cash taken on the till" },
  { key: "tips", label: "Tips", auto: true, hint: "Card and cash tips on the till: staff's money, not sales" },
  { key: "bank_in", label: "Bank in", auto: false, hint: "Cash taken out of the drawer: deposited or given to the owner" },
  { key: "commission", label: "Commission & card fees", auto: false, hint: "Worked out: the platform commissions below + the card fee" },
  { key: "pending", label: "Pending", auto: true, hint: "Bills still owed to us" },
  { key: "takeaway", label: "Takeaway", auto: true, hint: "Takeaway sales on the till" },
  { key: "just_eat", label: "Just Eat", auto: false, hint: "Sales from the payout summary" },
  { key: "just_eat_commission", label: "Just Eat commission", auto: false, hint: "Commission on the payout summary" },
  { key: "deliveroo", label: "Deliveroo", auto: false, hint: "Sales from the payout summary" },
  { key: "deliveroo_commission", label: "Deliveroo commission", auto: false, hint: "Commission on the payout summary" },
  { key: "uber_eats", label: "Uber Eats", auto: false, hint: "Sales from the payout summary" },
  { key: "uber_eats_commission", label: "Uber Eats commission", auto: false, hint: "Commission on the payout summary" },
  { key: "hiest", label: "Hiest", auto: false, hint: "Sales from the payout summary" },
  { key: "hiest_commission", label: "Hiest commission", auto: false, hint: "Commission on the payout summary" },
  { key: "catering_paid", label: "Catering paid", auto: false, hint: "Catering money received" },
  { key: "catering_pending", label: "Catering pending", auto: false, hint: "Catering money still owed" },
  { key: "opening_balance", label: "Opening balance", auto: true, hint: "Cash in the drawer at the start of the day" },
  { key: "closing_balance", label: "Closing balance", auto: true, hint: "Cash counted in the drawer at close" },
] as const;

export type DailyFieldKey = (typeof DAILY_FIELDS)[number]["key"];
export type DailyValues = Record<DailyFieldKey, number | null>;

export const DAILY_KEYS = DAILY_FIELDS.map((f) => f.key) as DailyFieldKey[];

// Each delivery platform's sales box and its commission box.
export const PLATFORM_COMMISSION = {
  just_eat: "just_eat_commission",
  deliveroo: "deliveroo_commission",
  uber_eats: "uber_eats_commission",
  hiest: "hiest_commission",
} as const satisfies Record<string, DailyFieldKey>;
const COMMISSION_KEYS = Object.values(PLATFORM_COMMISSION) as DailyFieldKey[];

/** Worked out, never typed: `commission` is saved as the platform commissions' total. */
export const isComputedField = (key: DailyFieldKey) => key === "commission";

/**
 * The month sheet and Excel show one commission column ("Commission & card
 * fees"), so the per-platform commission boxes are on the day form only.
 */
// Takeaway (till only) is left off the day form, month sheet and Excel for now.
export const HIDDEN_FIELDS: DailyFieldKey[] = ["takeaway"];
export const SHEET_FIELDS = DAILY_FIELDS.filter((f) => !COMMISSION_KEYS.includes(f.key) && !HIDDEN_FIELDS.includes(f.key));

/**
 * The cash drawer check (agreed 2026-10-11), used by the day form, month
 * sheet, Excel, dashboard and morning email alike:
 *   Expected = Opening + Cash sales + Money in − Money out − Bank in
 *   Variance = Counted (closing) − Expected   (minus = missing, plus = extra)
 * Money in / out = the staff link's Cash In / Out and the till's Cash Out.
 * No opening or no count → can't say (null).
 */
export function cashCheck(i: { opening: number | null; cash: number; moneyIn: number; moneyOut: number; bankIn: number; counted: number | null }) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const expected = i.opening == null ? null : r(i.opening + i.cash + i.moneyIn - i.moneyOut - i.bankIn);
  return { expected, variance: expected == null || i.counted == null ? null : r(i.counted - expected) };
}

/** The platform commissions' total, or null when none was entered. */
export function platformCommission(values: Partial<Record<DailyFieldKey, unknown>>): number | null {
  const entered = COMMISSION_KEYS.map((k) => values[k]).filter((v) => v != null && v !== "");
  if (entered.length === 0) return null;
  return Math.round(entered.reduce<number>((s, v) => s + Number(v), 0) * 100) / 100;
}
