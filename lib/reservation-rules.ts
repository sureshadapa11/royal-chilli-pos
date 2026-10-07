// When a booking can be seated or marked a no-show (POS → Reservations, and
// enforced by PUT /api/reservations). Dates and times are UK wall-clock.
// Safe to import in the browser.
import { londonNowDateAndMinutes } from "@/lib/hours";
import { tradingDayStr } from "@/lib/london-date";

const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Seat only on the booking's own day — the calendar day, or the trading day
 *  (till 5am), so a late booking can still be seated after midnight. */
export function canSeatNow(reservationDate: string, now: Date = new Date()): boolean {
  return reservationDate === londonNowDateAndMinutes(now).dateStr || reservationDate === tradingDayStr(now);
}

/** A no-show only once the booked time has come. */
export function canMarkNoShow(reservationDate: string, reservationTime: string, now: Date = new Date()): boolean {
  const { dateStr, minutesOfDay } = londonNowDateAndMinutes(now);
  return reservationDate < dateStr || (reservationDate === dateStr && minutesOfDay >= minutesOf(reservationTime));
}

/** "29 Oct" — for "Seat on 29 Oct". */
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
