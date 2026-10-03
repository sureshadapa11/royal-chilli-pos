import { NextRequest, NextResponse } from "next/server";
import { createSession, getSessionCookieOptions } from "@/lib/auth";
import { clearPinFailures, findStaffByPin, pinLockedFor, recordPinFailure } from "@/lib/staff-pin";
import { tillFromRequest } from "@/lib/till-device";

// POST { pin } — sign in at the till with a 4-digit PIN. Only on a paired
// till (lib/till-device.ts); anywhere else staff use username + password.
// The session is the PIN owner's own, with their own role.
export async function POST(req: NextRequest) {
  const till = await tillFromRequest(req);
  if (!till) {
    return NextResponse.json({ error: "This device isn't set up as a till — a manager needs to sign in with their password first." }, { status: 403 });
  }

  // Throttle per till device, not per PIN.
  const key = `till:${till.deviceId}`;
  const wait = pinLockedFor(key);
  if (wait > 0) return NextResponse.json({ error: `Too many wrong PINs — try again in ${wait}s.` }, { status: 429 });

  const { pin } = await req.json().catch(() => ({}));
  const staff = await findStaffByPin(String(pin ?? ""), till.businessId);
  if (!staff) {
    recordPinFailure(key);
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  clearPinFailures(key);

  // Only this business's staff (and the owner) are found on its till.
  const user = { id: staff.id, name: staff.name, role: staff.role, businessId: till.businessId, ...(staff.owner ? { owner: true } : {}) };
  const { name, options } = getSessionCookieOptions(req.headers.get("host"));
  const res = NextResponse.json({ user });
  res.cookies.set(name, await createSession(user), options);
  return res;
}
