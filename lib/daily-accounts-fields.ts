// The day-end accounts sheet's columns, in the paper sheet's order. `auto`
// fields are pre-filled from the till (still editable); the rest are typed in
// by the manager. Safe to import in the browser.
export const DAILY_FIELDS = [
  { key: "z_report", label: "Z report", auto: true, hint: "Net sales on the till's Z report (tips not included)" },
  { key: "card", label: "Card", auto: true, hint: "Card taken on the till" },
  { key: "cash", label: "Cash", auto: true, hint: "Cash taken on the till" },
  { key: "tips", label: "Tips", auto: true, hint: "Card and cash tips on the till: staff's money, not sales" },
  { key: "bank_in", label: "Bank in", auto: false, hint: "Cash paid into the bank" },
  { key: "commission", label: "Commission", auto: false, hint: "Total commission from platform payout summaries" },
  { key: "pending", label: "Pending", auto: true, hint: "Pay-later bills still unpaid" },
  { key: "takeaway", label: "Takeaway", auto: true, hint: "Takeaway sales on the till" },
  { key: "just_eat", label: "Just Eat", auto: false, hint: "Sales from the platform payout summary" },
  { key: "deliveroo", label: "Deliveroo", auto: false, hint: "Sales from the platform payout summary" },
  { key: "uber_eats", label: "Uber Eats", auto: false, hint: "Sales from the platform payout summary" },
  { key: "hiest", label: "Hiest", auto: false, hint: "Sales from the platform payout summary" },
  { key: "catering_paid", label: "Catering paid", auto: false, hint: "Catering money received" },
  { key: "catering_pending", label: "Catering pending", auto: false, hint: "Catering money still owed" },
  { key: "opening_balance", label: "Opening balance", auto: true, hint: "Cash in the drawer at opening (Z report)" },
  { key: "closing_balance", label: "Closing balance", auto: true, hint: "Cash counted at Close Day (Z report)" },
] as const;

export type DailyFieldKey = (typeof DAILY_FIELDS)[number]["key"];
export type DailyValues = Record<DailyFieldKey, number | null>;

export const DAILY_KEYS = DAILY_FIELDS.map((f) => f.key) as DailyFieldKey[];
