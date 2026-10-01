import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";
import { accessibleLocations, getLocationAnalytics, parseDateRange, resolveReportLocation } from "@/lib/location-analytics";

/**
 * GET /api/analytics/locations?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&location_id=N
 * Per-location sales, inventory and staff snapshot for the locations this
 * session may see (its assigned locations; all of them for the group owner or
 * an unassigned manager).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const range = parseDateRange(searchParams);
  if ("error" in range) return NextResponse.json({ error: range.error }, { status: 400 });

  try {
    let locations;
    const locationParam = searchParams.get("location_id");
    if (locationParam != null && locationParam !== "") {
      const resolved = await resolveReportLocation(session, Number(locationParam));
      if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      locations = [resolved.location];
    } else {
      locations = await accessibleLocations(session);
    }
    const report = await getLocationAnalytics(session.businessId, locations, range.from, range.to);
    return NextResponse.json(report);
  } catch (error) {
    console.error("Location analytics error:", error);
    return NextResponse.json({ error: "Failed to load location analytics" }, { status: 500 });
  }
}
