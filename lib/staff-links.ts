import { randomBytes, timingSafeEqual } from "crypto";
import supabase from "@/lib/supabase";
import { getBusinessSetting, saveBusinessSettings } from "@/lib/business-settings";
import { NOT_ON_ROTA } from "@/lib/roles";
import { clearPinFailures, findStaffByPin, pinLockedFor, recordPinFailure } from "@/lib/staff-pin";

// Staff links: the Day End and Cash In/Out forms, opened from a saved link or
// the QR on the wall — no Staff Hub login. The link carries a business's
// secret (Settings → Staff links, "Make a new link" replaces it) and staff
// say who they are with their 4-digit till PIN. The links only take input:
// nothing is ever read back through them.

const KEY = "staff_links_token";
const NOT_PAYABLE: string[] = ["admin", ...NOT_ON_ROTA];

/** "<business id>-<secret>": the id says where to look, the secret proves it. */
export async function staffLinkToken(businessId: number, rotate = false): Promise<string> {
  const current = await getBusinessSetting<string>(businessId, KEY);
  if (current && !rotate) return current;
  const token = `${businessId}-${randomBytes(18).toString("base64url")}`;
  await saveBusinessSettings(businessId, { [KEY]: token });
  return token;
}

/** The business a link token belongs to, or null if it's wrong or replaced. */
export async function businessForToken(token: unknown): Promise<number | null> {
  const t = String(token ?? "");
  const m = t.match(/^(\d+)-[A-Za-z0-9_-]{20,}$/);
  if (!m) return null;
  const businessId = Number(m[1]);
  const current = await getBusinessSetting<string>(businessId, KEY);
  if (!current || current.length !== t.length) return null;
  return timingSafeEqual(Buffer.from(current), Buffer.from(t)) ? businessId : null;
}

export type LinkStaff = { id: number; name: string };

/**
 * Who is entering: the link's business and the PIN's staff member. Five wrong
 * PINs lock the link for a minute (per server, like the till's PIN pad).
 */
export async function linkStaff(token: unknown, pin: unknown): Promise<
  { ok: true; businessId: number; staff: LinkStaff } | { ok: false; status: number; error: string }
> {
  const businessId = await businessForToken(token);
  if (!businessId) return { ok: false, status: 404, error: "This link isn't working any more. Ask a manager for the new one." };
  const lockKey = `link:${businessId}`;
  const wait = pinLockedFor(lockKey);
  if (wait) return { ok: false, status: 429, error: `Too many wrong PINs. Try again in ${wait} seconds.` };
  const staff = await findStaffByPin(String(pin ?? ""), businessId);
  if (!staff) {
    recordPinFailure(lockKey);
    return { ok: false, status: 401, error: "That PIN isn't right." };
  }
  clearPinFailures(lockKey);
  return { ok: true, businessId, staff: { id: staff.id, name: staff.name } };
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** An amount typed on a form: null when blank, otherwise 0…10m to the penny. */
export function money(raw: unknown): number | null | "bad" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return "bad";
  return Math.round(n * 100) / 100;
}

/**
 * Who a link's "Wages in cash" / "Staff advance" can be for: this business's
 * active staff who are on the rota — never the owners / Super admin, or HR and
 * Supervisor (not on the rota, so not paid this way). Staff are one shared
 * table, so this filters by business_id rather than bizDb.
 */
export async function payableStaff(businessId: number): Promise<{ id: number; name: string }[]> {
  const { data } = await supabase.from("staff").select("id, name, role, is_owner")
    .eq("business_id", businessId).eq("active", 1).order("name");
  return (data ?? [])
    .filter((s) => !s.is_owner && !NOT_PAYABLE.includes(String(s.role)))
    .map((s) => ({ id: s.id as number, name: s.name as string }));
}
