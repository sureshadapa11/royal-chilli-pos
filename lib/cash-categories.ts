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
};

export const CASH_CATEGORIES: CashCategory[] = [
  { key: "food_stock", label: "Ingredients / stock (cash buy)", icon: "🥬", direction: "out", home: "expense", expenseCategory: "food_stock", vat: false, photo: true },
  { key: "supplier_payment", label: "Supplier payment", icon: "🧾", direction: "out", home: "supplier", pick: "supplier", photo: true },
  { key: "cleaning", label: "Cleaning & supplies", icon: "🧹", direction: "out", home: "expense", expenseCategory: "cleaning", vat: true, photo: true },
  { key: "repairs", label: "Repairs & maintenance", icon: "🔧", direction: "out", home: "expense", expenseCategory: "repairs", vat: true, photo: true },
  { key: "utilities", label: "Utilities / bills", icon: "⚡", direction: "out", home: "expense", expenseCategory: "utilities", vat: true, photo: true },
  { key: "marketing", label: "Marketing", icon: "📣", direction: "out", home: "expense", expenseCategory: "marketing", vat: true, photo: true },
  { key: "wages", label: "Staff wages paid in cash", icon: "💷", direction: "out", home: "wages", pick: "staff", photo: false },
  { key: "staff_advance", label: "Staff advance", icon: "🤝", direction: "out", home: "advance", pick: "staff", photo: false },
  // Cash given to the owner is entered as Bank in (Day End / Daily accounts), not here — so it is never taken off twice.
  { key: "owner_out", label: "Given to owner / management", icon: "👤", direction: "out", home: "book", photo: false, hidden: true },
  { key: "event_costs", label: "Event costs", icon: "🎪", direction: "out", home: "expense", expenseCategory: "event_costs", vat: true, photo: true },
  { key: "customer_refund", label: "Refund to customer", icon: "↩️", direction: "out", home: "expense", expenseCategory: "customer_refund", vat: false, photo: true },
  { key: "other", label: "Other", icon: "❓", direction: "out", home: "expense", expenseCategory: "other", vat: true, photo: true, reasonRequired: true },
  // Replaced by job payments (133); kept so older entries still read right.
  { key: "catering", label: "Catering payment received", icon: "🍱", direction: "in", home: "book", photo: false, hidden: true },
  { key: "job_payment", label: "Catering / event payment received", icon: "🎉", direction: "in", home: "job", pick: "job", photo: false },
  { key: "advance_repaid", label: "Staff advance repaid", icon: "🤝", direction: "in", home: "advance", pick: "staff", photo: false },
  { key: "owner_in", label: "Owner put cash in", icon: "👤", direction: "in", home: "book", photo: false },
  { key: "other_in", label: "Other income", icon: "❓", direction: "in", home: "book", photo: false, reasonRequired: true },
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
