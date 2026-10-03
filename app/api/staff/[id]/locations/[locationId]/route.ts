import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { staffLocationIds } from "@/lib/locations";
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
  if (!session || !areaAllows(session.role, "hr", req.method)) {
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

    // Same rule as PATCH: a manager can only take away locations they're
    // assigned to themselves; only the group owner isn't limited.
    if (!session.owner && !(await staffLocationIds(session.id)).includes(locationId)) {
      return NextResponse.json({ error: "You can only remove locations you're assigned to" }, { status: 403 });
    }

    const current = (await staffLocationIds(staffId)).sort((a, b) => a - b);
    if (!current.includes(locationId)) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }
    if (staffId === session.id && current.length === 1) {
      return NextResponse.json({ error: "You must keep at least one location" }, { status: 400 });
    }

    const { error } = await supabase
      .from("staff_locations")
      .delete()
      .eq("staff_id", staffId)
      .eq("location_id", locationId);
    if (error) throw error;

    const { error: auditError } = await db.from("audit_logs").insert({
      staff_id: session.id,
      action: "staff_location_assignment",
      entity_type: "staff",
      entity_id: staffId,
      changes: { from: current, to: current.filter((id) => id !== locationId) },
    });
    if (auditError) console.error("Staff location audit log error:", auditError);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove staff location error:", error);
    return NextResponse.json({ error: "Failed to remove assignment" }, { status: 500 });
  }
}
