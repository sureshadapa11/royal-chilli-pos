// "Why did you stop coming?" — the reasons a customer can tap, and when
// someone is due the email. Pure and safe to import in the browser.

export const WINBACK_REASONS = [
  { key: "food", guest: "The food wasn't quite right", short: "Food" },
  { key: "service", guest: "The service let me down", short: "Service" },
  { key: "price", guest: "It felt too expensive", short: "Price" },
  { key: "distance", guest: "You're a bit far from me", short: "Distance" },
  { key: "waiting", guest: "I waited too long", short: "Waiting" },
  { key: "busy", guest: "Nothing's wrong, I've just been busy", short: "Just busy" },
] as const;
export type WinBackReason = (typeof WINBACK_REASONS)[number]["key"];
export const isWinBackReason = (v: unknown): v is WinBackReason => WINBACK_REASONS.some((r) => r.key === v);

export const WINBACK_AFTER_DAYS = 21;   // no visit for this long → ask
export const ASK_AGAIN_AFTER_DAYS = 90; // never more often than this
export const GIVE_UP_AFTER_DAYS = 180;  // gone this long → leave them be

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);

/**
 * Due the email today? Their last visit was 21–180 days ago, and they haven't
 * been asked since that visit (and not in the last 90 days). Pure.
 */
export function winBackDue(lastVisit: string | null, lastAsked: string | null, today: string): boolean {
  if (!lastVisit) return false;
  const away = daysBetween(lastVisit, today);
  if (away < WINBACK_AFTER_DAYS || away > GIVE_UP_AFTER_DAYS) return false;
  if (!lastAsked) return true;
  return lastAsked < lastVisit && daysBetween(lastAsked, today) >= ASK_AGAIN_AFTER_DAYS;
}
