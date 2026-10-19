import { isNearOpeningHours, type WeekHours } from "@/lib/hours";

// Pacing for the till's always-on background checks (Print Station, new-order
// alerts). Each check is a Vercel function call, and the project is on the
// free plan (~1M calls / 4h CPU a month) — checking every few seconds around
// the clock on every open screen would blow through that and get the whole
// POS and website paused. So: full speed around opening hours, a check every
// couple of minutes otherwise (still catches the odd late/early order).
export const CLOSED_INTERVAL_MS = 2 * 60_000;

// The busy part of the day for pacing only (8am–1am every day, the widest any
// business opens today) — not anyone's opening hours.
const BUSY_WINDOW: WeekHours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 8 * 60, close: 25 * 60 }]));

// True if a check is due now: always when near opening hours, otherwise only
// once CLOSED_INTERVAL_MS has passed since the last one.
export function checkDue(lastCheckAt: number, now: Date = new Date()): boolean {
  return isNearOpeningHours(BUSY_WINDOW, now) || now.getTime() - lastCheckAt >= CLOSED_INTERVAL_MS;
}
