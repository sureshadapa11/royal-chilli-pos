import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageFinance } from "@/lib/permissions";
import { rangeDates, type RangeKey } from "@/lib/admin-dashboard";
import { getDashboardCards, mergeDashboardCards } from "@/lib/dashboard-cards";
import { listBusinesses } from "@/lib/business";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";
import { tradingDayStr } from "@/lib/london-date";

const RANGES: RangeKey[] = ["this_week", "last_week", "this_month", "last_month"];

// GET ?range= — the dashboard cards built from Daily accounts, Expenses and
// Attendance for that period (and the one before), so the period buttons only
// refresh these cards and the Summary.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const range = req.nextUrl.searchParams.get("range") as RangeKey;
  if (!RANGES.includes(range)) return NextResponse.json({ error: "Pick a valid period" }, { status: 400 });

  try {
    const today = tradingDayStr();
    const cur = rangeDates(range, today);
    const allMode = !!session.owner && (await cookies()).get(ALL_BUSINESSES_COOKIE)?.value === "1";
    const cards = allMode
      ? mergeDashboardCards(await Promise.all((await listBusinesses()).map((b) => getDashboardCards(b.id, range, cur, today))))
      : await getDashboardCards(session.businessId, range, cur, today);
    return NextResponse.json(cards, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Dashboard cards error:", error);
    return NextResponse.json({ error: "Couldn't load the dashboard" }, { status: 500 });
  }
}
