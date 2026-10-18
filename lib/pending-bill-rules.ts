// Pending bills (134) on the Day End link — rules shared by the form and its
// API (agreed 2026-10-18). Safe in the browser.

/** How far back an unpaid bill's own date can go from the Day End it's entered on. */
export const BILL_DATE_DAYS_BACK = 62;

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Earliest date an unpaid bill entered on `dayEnd` can carry. */
export const earliestBillDate = (dayEnd: string) => addDays(dayEnd, -BILL_DATE_DAYS_BACK);

/** An unpaid bill's date: the Day End's own day, or up to two months before it. */
export function billDateProblem(billDate: string, dayEnd: string): string | null {
  if (billDate > dayEnd) return "A bill's date can't be after the Day End day.";
  if (billDate < earliestBillDate(dayEnd)) return "A bill's date can be up to two months before the Day End day.";
  return null;
}

/**
 * Soft check on the Day End link: an unpaid bill is in that day's SumUp Z
 * (owner, 2026-10-18), so with bills dated today the Z should be Card + Cash +
 * those bills. Returns what the Z would be when it doesn't add up, else null.
 */
export function zMissingBills(z: number, card: number, cash: number, billsToday: number): number | null {
  if (!(billsToday > 0)) return null;
  const expected = Math.round((card + cash + billsToday) * 100) / 100;
  return Math.abs(z - expected) > 0.009 ? expected : null;
}
