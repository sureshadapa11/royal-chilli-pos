import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { getAdminSummary, mergeAdminSummaries, type RangeKey } from "@/lib/admin-dashboard";
import { listBusinesses } from "@/lib/business";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";

const SUMMARY_RANGES: RangeKey[] = ["this_week", "last_week", "this_month", "last_month"];

// Fetch only the Summary card data so changing its period doesn't refresh the
// rest of the Staff Hub dashboard.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = req.nextUrl.searchParams.get("range");
  if (!requested || !SUMMARY_RANGES.includes(requested as RangeKey)) {
    return NextResponse.json({ error: "Pick a valid summary period" }, { status: 400 });
  }
  const range = requested as RangeKey;

  try {
    const allMode = !!session.owner && (await cookies()).get(ALL_BUSINESSES_COOKIE)?.value === "1";
    const summary = allMode
      ? mergeAdminSummaries(await Promise.all((await listBusinesses()).map((business) => getAdminSummary(business.id, range))))
      : await getAdminSummary(session.businessId, range);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Staff Hub summary error:", error);
    return NextResponse.json({ error: "Couldn't load the summary" }, { status: 500 });
  }
}
