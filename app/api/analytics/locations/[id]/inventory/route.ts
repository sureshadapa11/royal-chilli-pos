import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";
import { getLocationInventory, resolveReportLocation } from "@/lib/location-analytics";

/** GET /api/analytics/locations/:id/inventory — ingredients held at one location. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const resolved = await resolveReportLocation(session, Number((await params).id));
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    const ingredients = await getLocationInventory(session.businessId, resolved.location.id);
    return NextResponse.json({ ingredients });
  } catch (error) {
    console.error("Location inventory error:", error);
    return NextResponse.json({ error: "Failed to load location inventory" }, { status: 500 });
  }
}
