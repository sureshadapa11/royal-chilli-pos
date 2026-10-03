import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { getLocationStaff, parseDateRange, resolveReportLocation } from "@/lib/location-analytics";

/** GET /api/analytics/locations/:id/staff?start_date=&end_date= — staff activity at one location. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "analytics", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const range = parseDateRange(new URL(req.url).searchParams);
  if ("error" in range) return NextResponse.json({ error: range.error }, { status: 400 });
  try {
    const resolved = await resolveReportLocation(session, Number((await params).id));
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    const staff = await getLocationStaff(session.businessId, resolved.location.id, range.from, range.to);
    return NextResponse.json({ staff });
  } catch (error) {
    console.error("Location staff error:", error);
    return NextResponse.json({ error: "Failed to load location staff" }, { status: 500 });
  }
}
