import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canViewCrm } from "@/lib/permissions";
import { londonDayRangeUtc } from "@/lib/london-date";

// Admin-facing redemption activity log (doc §20 "Redemptions — view and
// filter redemption activity"). Most recent first, capped — this is a log
// view, not a paginated export. An optional `to` date (YYYY-MM-DD) narrows
// it to codes issued on or before that day, same "up to this date" cutoff
// convention as History's Pending Bills filter.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canViewCrm(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const to = req.nextUrl.searchParams.get("to");
  let query = db
    .from("loyalty_redemptions")
    // The code's owner — a redemption also links to a customer as the Bring a
    // Friend "friend", so the link must be named or the query fails.
    .select("id, code, status, points_spent, issued_at, expires_at, redeemed_at, reward:loyalty_rewards(name), customer:customers!loyalty_redemptions_customer_id_fkey(name, phone)")
    .order("issued_at", { ascending: false })
    .limit(100);
  if (to) {
    // End of that UK calendar day (not UTC).
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("issued_at", londonDayRangeUtc(to).end);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch redemptions" }, { status: 500 });
  return NextResponse.json({ redemptions: data });
}
