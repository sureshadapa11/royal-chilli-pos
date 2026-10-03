// The kinds of "other" expense (Inventory → Spending → Expenses), matching the
// expenses.category check in the database. Safe to import in the browser.
export const EXPENSE_CATEGORIES = [
  { key: "rent", label: "Rent" },
  { key: "utilities", label: "Utilities" },
  { key: "marketing", label: "Marketing" },
  { key: "equipment", label: "Equipment" },
  { key: "professional_fees", label: "Professional fees" },
  { key: "other", label: "Other expenses" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];
