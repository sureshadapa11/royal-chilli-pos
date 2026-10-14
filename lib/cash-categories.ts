// Cash In / Out categories (staff links, migration 130). Each has ONE home,
// so the same money is never entered or counted twice. Safe in the browser.
//   home "expense"  → creates the expense (counted in Money out → Expenses)
//   home "supplier" → creates a supplier payment (not counted: the stock is
//                     counted when its delivery is received)
//   home "wages"    → taken off that person's payslip (wages are already
//                     counted as hours × pay rate)
//   home "advance"  → staff advances (a loan, not a cost)
//   home "book"     → the cash book only
//   home "job"      → a payment towards a catering / event job (133): sales
//                     when paid by cash or bank transfer (lib/catering-jobs.ts)
export type CashHome = "expense" | "supplier" | "wages" | "advance" | "book" | "job";
export type CashCategory = {
  key: string; label: string; icon: string; direction: "in" | "out"; home: CashHome;
  expenseCategory?: string; vat?: boolean;
  pick?: "staff" | "supplier" | "job";
  photo: boolean;          // receipt photo required
  reasonRequired?: boolean;
  /** No longer offered (kept so old entries still read right). */
  hidden?: boolean;
  /** Which cash book (136). All Money In / Out cash goes through the Safe — the till only holds the float and cash sales (agreed 2026-10-14). */
  place: Place;
  /** Only the Safe (moving Safe money to the bank / owner). */
  safeOnly?: boolean;
};

/** The two cash books (136): 🧾 Till (the drawer) and 🔒 Safe (cash that doesn't go through the till). */
export type Place = "till" | "safe";
export const PLACES: { key: Place; label: string; icon: string }[] = [
  { key: "till", label: "Till", icon: "🧾" },
  { key: "safe", label: "Safe", icon: "🔒" },
];
export const placeLabel = (p: string | null | undefined) => (p === "safe" ? "🔒 Safe" : "🧾 Till");

export const CASH_CATEGORIES: CashCategory[] = [
  { key: "food_stock", label: "Ingredients / stock (cash buy)", icon: "🥬", direction: "out", home: "expense", expenseCategory: "food_stock", vat: false, photo: true, place: "safe" },
  { key: "supplier_payment", label: "Supplier payment", icon: "🧾", direction: "out", home: "supplier", pick: "supplier", photo: true, place: "safe" },
  { key: "cleaning", label: "Cleaning & supplies", icon: "🧹", direction: "out", home: "expense", expenseCategory: "cleaning", vat: true, photo: true, place: "safe" },
  { key: "repairs", label: "Repairs & maintenance", icon: "🔧", direction: "out", home: "expense", expenseCategory: "repairs", vat: true, photo: true, place: "safe" },
  { key: "utilities", label: "Utilities / bills", icon: "⚡", direction: "out", home: "expense", expenseCategory: "utilities", vat: true, photo: true, place: "safe" },
  { key: "marketing", label: "Marketing", icon: "📣", direction: "out", home: "expense", expenseCategory: "marketing", vat: true, photo: true, place: "safe" },
  { key: "wages", label: "Staff wages paid in cash", icon: "💷", direction: "out", home: "wages", pick: "staff", photo: false, place: "safe" },
  { key: "staff_advance", label: "Staff advance", icon: "🤝", direction: "out", home: "advance", pick: "staff", photo: false, place: "safe" },
  // Replaced by the Day End's "Cash taken to Safe" and the Safe's "Given to owner" (136).
  { key: "owner_out", label: "Given to owner / management", icon: "👤", direction: "out", home: "book", photo: false, hidden: true, place: "safe" },
  { key: "event_costs", label: "Event costs", icon: "🎪", direction: "out", home: "expense", expenseCategory: "event_costs", vat: true, photo: true, place: "safe" },
  { key: "customer_refund", label: "Refund to customer", icon: "↩️", direction: "out", home: "expense", expenseCategory: "customer_refund", vat: false, photo: true, place: "safe" },
  // Photo optional (agreed 2026-10-14); the reason is still required.
  { key: "other", label: "Other", icon: "❓", direction: "out", home: "expense", expenseCategory: "other", vat: true, photo: false, reasonRequired: true, place: "safe" },
  // Replaced by job payments (133); kept so older entries still read right.
  { key: "catering", label: "Catering payment received", icon: "🍱", direction: "in", home: "book", photo: false, hidden: true, place: "safe" },
  { key: "job_payment", label: "Catering / event payment received", icon: "🎉", direction: "in", home: "job", pick: "job", photo: false, place: "safe" },
  { key: "advance_repaid", label: "Staff advance repaid", icon: "🤝", direction: "in", home: "advance", pick: "staff", photo: false, place: "safe" },
  // Moving Safe money out (136): not costs, just where the cash went.
  { key: "safe_to_bank", label: "Paid into bank (from Safe)", icon: "🏦", direction: "out", home: "book", photo: false, place: "safe", safeOnly: true },
  { key: "safe_to_owner", label: "Given to owner (from Safe)", icon: "👤", direction: "out", home: "book", photo: false, place: "safe", safeOnly: true },
  { key: "owner_in", label: "Owner put cash in", icon: "👤", direction: "in", home: "book", photo: false, place: "safe" },
  { key: "other_in", label: "Other income", icon: "❓", direction: "in", home: "book", photo: false, reasonRequired: true, place: "safe" },
];

/** How it was paid (132). Only cash moves the drawer, so only cash is in the cash check. */
export const PAY_METHODS = [
  { key: "cash", label: "Cash", icon: "💷" },
  { key: "card", label: "Card", icon: "💳" },
  { key: "bank", label: "Bank transfer", icon: "🏦" },
] as const;
export type PayMethod = (typeof PAY_METHODS)[number]["key"];
export const payMethodLabel = (key: string | null | undefined) => PAY_METHODS.find((m) => m.key === key)?.label ?? "Cash";

/** A line under a category on the form. */
export const CATEGORY_HINT: Record<string, string> = {
  catering: "Paid on our card machine? It's already in the Z report, so don't add it here.",
  job_payment: "Pick the job. Paid on our card machine? Choose Card: it counts toward the job but is already in the Z report.",
  event_costs: "Stall fee, hire, extra staff or anything else spent on an event.",
};

export const cashCategory = (key: string) => CASH_CATEGORIES.find((c) => c.key === key) ?? null;
export const cashCategoryLabel = (key: string) => cashCategory(key)?.label ?? key;
