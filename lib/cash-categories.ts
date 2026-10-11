// Cash In / Out categories (staff links, migration 130). Each has ONE home,
// so the same money is never entered or counted twice. Safe in the browser.
//   home "expense"  → creates the expense (counted in Money out → Expenses)
//   home "supplier" → creates a supplier payment (not counted: the stock is
//                     counted when its delivery is received)
//   home "wages"    → taken off that person's payslip (wages are already
//                     counted as hours × pay rate)
//   home "advance"  → staff advances (a loan, not a cost)
//   home "book"     → the cash book only
export type CashHome = "expense" | "supplier" | "wages" | "advance" | "book";
export type CashCategory = {
  key: string; label: string; icon: string; direction: "in" | "out"; home: CashHome;
  expenseCategory?: string; vat?: boolean;
  pick?: "staff" | "supplier";
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
  { key: "customer_refund", label: "Refund to customer", icon: "↩️", direction: "out", home: "expense", expenseCategory: "customer_refund", vat: false, photo: true },
  { key: "other", label: "Other", icon: "❓", direction: "out", home: "expense", expenseCategory: "other", vat: true, photo: true, reasonRequired: true },
  { key: "catering", label: "Catering payment received", icon: "🍱", direction: "in", home: "book", photo: false },
  { key: "advance_repaid", label: "Staff advance repaid", icon: "🤝", direction: "in", home: "advance", pick: "staff", photo: false },
  { key: "owner_in", label: "Owner put cash in", icon: "👤", direction: "in", home: "book", photo: false },
  { key: "other_in", label: "Other income", icon: "❓", direction: "in", home: "book", photo: false, reasonRequired: true },
];

export const cashCategory = (key: string) => CASH_CATEGORIES.find((c) => c.key === key) ?? null;
export const cashCategoryLabel = (key: string) => cashCategory(key)?.label ?? key;
