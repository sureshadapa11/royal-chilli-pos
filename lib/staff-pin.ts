import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import type { SessionUser } from "@/lib/types";

// 4-digit till PINs (staff.pin_hash, bcrypt). On a paired till (lib/till-
// device.ts) staff sign in with just their PIN (app/api/auth/pin-login), so
// every order, payment, void, discount and Close Day is recorded against the
// right person. A manager's PIN also approves refunds.

export const PIN_PATTERN = /^\d{4}$/;
export { MANAGER_ROLES, isManagerRole } from "@/lib/roles";

type PinStaff = { id: number; name: string; role: SessionUser["role"]; pin_hash: string | null; is_owner: boolean };

// The active staff member of this business whose PIN this is (or the group
// owner, who can sign in on any business's till), or null. Checks a handful
// of bcrypt hashes, so PINs must be unique within a business.
export async function findStaffByPin(
  pin: string,
  businessId: number,
  exceptId?: number,
): Promise<(Omit<SessionUser, "businessId"> & { owner: boolean }) | null> {
  if (!PIN_PATTERN.test(pin)) return null;
  const { data } = await supabase.from("staff").select("id, name, role, pin_hash, is_owner")
    .eq("active", 1).not("pin_hash", "is", null)
    .or(`business_id.eq.${Number(businessId)},is_owner.eq.true`);
  for (const s of (data ?? []) as PinStaff[]) {
    if (s.id === exceptId || !s.pin_hash) continue;
    if (await bcrypt.compare(pin, s.pin_hash)) return { id: s.id, name: s.name, role: s.role, owner: !!s.is_owner };
  }
  return null;
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

// ---------- wrong-PIN throttle ----------
// 5 wrong tries lock the PIN pad for a minute, per till. Kept in
// memory (per server instance) — PIN sign-in also only works on a paired
// till, so it can't be tried from outside.
const LOCK_MS = 60_000;
const MAX_TRIES = 5;
const failures = new Map<string, { count: number; lockedUntil: number }>();

// Seconds left on a lock, or 0.
export function pinLockedFor(key: string, now = Date.now()): number {
  const f = failures.get(key);
  return f && f.lockedUntil > now ? Math.ceil((f.lockedUntil - now) / 1000) : 0;
}

export function recordPinFailure(key: string, now = Date.now()): void {
  const count = (failures.get(key)?.count ?? 0) + 1;
  failures.set(key, count >= MAX_TRIES ? { count: 0, lockedUntil: now + LOCK_MS } : { count, lockedUntil: 0 });
}

export function clearPinFailures(key: string): void {
  failures.delete(key);
}
