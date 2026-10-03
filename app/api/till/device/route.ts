import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { isManagerRole } from "@/lib/staff-pin";
import { createTillToken, tillCookieOptions, tillFromRequest, TILL_COOKIE } from "@/lib/till-device";
import { bizDb } from "@/lib/business-db";

// Staff Hub → Settings → "Make this device a till". A manager signed in on the
// tablet sets it up once; staff then sign in on it with their PIN, and only a
// till can take orders and payments (tillRequired). Replaces the old tick box
// on the sign-in page.

/** Whether this device is a till of the business being worked in. */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const till = await tillFromRequest(req);
  return NextResponse.json({ paired: !!till && till.businessId === session.businessId, otherBusiness: !!till && till.businessId !== session.businessId });
}

async function managerOnly(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session.owner && !isManagerRole(session.role)) {
    return { error: NextResponse.json({ error: "Only a manager can set up a till" }, { status: 403 }) };
  }
  return { session };
}

/** Make this device a till of the business being worked in. */
export async function POST(req: NextRequest) {
  const { session, error } = await managerOnly(req);
  if (error) return error;
  const res = NextResponse.json({ success: true, paired: true });
  res.cookies.set(TILL_COOKIE, await createTillToken(session.id, session.businessId), tillCookieOptions());
  await bizDb(session.businessId).from("audit_logs").insert({
    staff_id: session.id, action: "till_paired", entity_type: "device", entity_id: null,
    changes: { host: req.headers.get("host")?.slice(0, 255) ?? null },
  }).then(({ error: e }) => e && console.error("Till pair audit failed:", e));
  return res;
}

/** Stop using this device as a till. */
export async function DELETE(req: NextRequest) {
  const { session, error } = await managerOnly(req);
  if (error) return error;
  const res = NextResponse.json({ success: true, paired: false });
  res.cookies.set(TILL_COOKIE, "", { ...tillCookieOptions(), maxAge: 0 });
  await bizDb(session.businessId).from("audit_logs").insert({
    staff_id: session.id, action: "till_unpaired", entity_type: "device", entity_id: null,
    changes: { host: req.headers.get("host")?.slice(0, 255) ?? null },
  }).then(({ error: e }) => e && console.error("Till unpair audit failed:", e));
  return res;
}
