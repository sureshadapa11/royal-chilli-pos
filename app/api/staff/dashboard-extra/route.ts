import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionFromRequest } from "@/lib/auth";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";
import { canManageFinance } from "@/lib/permissions";
import { rangeDates, addDays, type RangeKey } from "@/lib/admin-dashboard";
import { getExtraCards } from "@/lib/dashboard-extra";
import { tradingDayStr } from "@/lib/london-date";

const RANGES: RangeKey[] = ["today", "this_week", "last_week", "this_month", "last_month"];

/** The period just before, the same length. */
function before(r: { from: string; to: string }): { from: string; to: string } {
  const len = Math.round((Date.parse(`${r.to}T12:00:00Z`) - Date.parse(`${r.from}T12:00:00Z`)) / 86400000) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

// GET ?range= — the dashboard's newer cards (lib/dashboard-extra.ts). Money
// cards only for Super admin / Supervisor; Managers get sales and staff cards.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageFinance(session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const range = req.nextUrl.searchParams.get("range") as RangeKey;
  if (!RANGES.includes(range)) return NextResponse.json({ error: "Pick a valid period" }, { status: 400 });
  // These cards are per business; in the owner's All businesses view say so instead.
  if (session.owner && (await cookies()).get(ALL_BUSINESSES_COOKIE)?.value === "1") return NextResponse.json({ allBusinesses: true });
  try {
    const today = tradingDayStr();
    const cur = rangeDates(range, today);
    const withMoney = !!session.owner || session.role === "admin" || session.role === "supervisor";
    const cards = await getExtraCards(session.businessId, cur, before(cur), today, withMoney);
    return NextResponse.json({ ...cards, canSetTarget: !!session.owner || session.role === "admin" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Dashboard extra cards error:", error);
    return NextResponse.json({ error: "Couldn't load the dashboard" }, { status: 500 });
  }
}
