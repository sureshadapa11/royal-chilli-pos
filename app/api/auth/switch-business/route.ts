import { NextRequest, NextResponse } from "next/server";
import { createSession, getSessionCookieOptions, getSessionFromRequest } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { bizDb } from "@/lib/business-db";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";

// POST { businessId: "all" } — the owner's dashboard shows every business
// combined; the login itself stays with the current business (lib/owner-view).
//
// POST { businessId } — the group owner steps into another business. Only the
// owner can do this; everyone else works for their own business only. The
// new login works exactly like that business's own admin, and what the owner
// does there is recorded under the owner's name.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session?.owner) return NextResponse.json({ error: "Only the owner can switch business" }, { status: 403 });

  const { businessId } = await req.json().catch(() => ({}));
  const { name, options } = getSessionCookieOptions(req.headers.get("host"));
  const viewCookie = { ...options, maxAge: 60 * 60 * 24 * 365 };

  if (businessId === "all") {
    const res = NextResponse.json({ all: true });
    res.cookies.set(ALL_BUSINESSES_COOKIE, "1", viewCookie);
    return res;
  }

  const business = await getBusiness(Number(businessId));
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const res = NextResponse.json({ business: { id: business.id, name: business.name } });
  res.cookies.set(name, await createSession({ ...session, businessId: business.id }), options);
  // Picking one business ends the "All businesses" view.
  res.cookies.set(ALL_BUSINESSES_COOKIE, "", { ...viewCookie, maxAge: 0 });

  await bizDb(business.id).from("audit_logs").insert({
    staff_id: session.id, action: "owner_switched_business", entity_type: "business", entity_id: business.id,
    changes: { from: session.businessId, to: business.id },
  });
  return res;
}
