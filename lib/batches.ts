// Batches and use-by dates (inventory v2 phase 3, migration 118, agreed
// 2026-10-08): use-by today or tomorrow = "Use first", past it = "Expired".
// Use-by is a UK calendar date (londonDateStr), not a trading day.

export type ExpiryStatus = "expired" | "use_first" | "ok";

export const STORAGE_KINDS = ["fridge", "freezer", "dry", "other"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];
export const STORAGE_KIND_LABEL: Record<StorageKind, string> = { fridge: "Fridge", freezer: "Freezer", dry: "Dry store", other: "Other" };

function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** today = the UK date (YYYY-MM-DD). */
export function expiryStatus(expiry: string, today: string): ExpiryStatus {
  if (expiry < today) return "expired";
  if (expiry <= addDays(today, 1)) return "use_first";
  return "ok";
}

/** The last day still flagged "Use first" (tomorrow). */
export function useFirstUntil(today: string): string {
  return addDays(today, 1);
}
