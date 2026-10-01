import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import supabase from "@/lib/supabase";

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * DELETE /api/staff/[id]/locations/[locationId] — Remove location assignment from staff.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> },
) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await params;
  const staffId = parseId(resolved.id);
  const locationId = parseId(resolved.locationId);

  if (!staffId || !locationId) {
    return NextResponse.json({ error: "Invalid staff or location id" }, { status: 400 });
  }

  const db = bizDb(session.businessId);
  if (!(await staffWorksAt(db, staffId))) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  }

  try {
    // Verify location exists and belongs to this business
    const { data: location, error: locError } = await db
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .maybeSingle();
    if (locError) throw locError;
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const { error } = await supabase
      .from("staff_locations")
      .delete()
      .eq("staff_id", staffId)
      .eq("location_id", locationId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove staff location error:", error);
    const message = error instanceof Error ? error.message : "Failed to remove assignment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
