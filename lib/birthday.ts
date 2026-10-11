// Birthdays (Rewards Club): only the day and month are asked for, stored as
// date_of_birth = 2000-MM-DD (2000 is a leap year, so 29 February is valid).
// The birthday treat is created BIRTHDAY_LEAD_DAYS before the birthday and is
// valid for 14 days (the reward's valid_days). Pure and browser-safe.

export const BIRTHDAY_LEAD_DAYS = 7;
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A day and month from the form → "2000-MM-DD", or null if it isn't a real date. */
export function birthdayToDate(day: unknown, month: unknown): string | null {
  const d = Number(day), m = Number(month);
  if (!Number.isInteger(d) || !Number.isInteger(m) || m < 1 || m > 12 || d < 1 || d > DAYS_IN_MONTH[m - 1]) return null;
  return `2000-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2000-03-12" (any year) → "12 March". */
export function birthdayLabel(dob: string | null | undefined): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(dob ?? "");
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : null;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Is `date` (YYYY-MM-DD) this person's birthday? 29 Feb birthdays fall on 28 Feb in other years. */
export function isBirthdayOn(dob: string | null | undefined, date: string): boolean {
  const b = /^\d{4}-(\d{2})-(\d{2})/.exec(dob ?? "");
  if (!b) return false;
  const [y, m, d] = date.split("-").map(Number);
  let bm = Number(b[1]), bd = Number(b[2]);
  if (bm === 2 && bd === 29 && !isLeap(y)) bd = 28;
  return bm === m && bd === d;
}

/** The date whose birthdays get their treat today: BIRTHDAY_LEAD_DAYS ahead. */
export function birthdayTargetDate(today: string): string {
  const x = new Date(today + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() + BIRTHDAY_LEAD_DAYS);
  return x.toISOString().slice(0, 10);
}
