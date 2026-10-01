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
 * GET /api/staff/[id]/locations — List locations assigned to a staff member.
 * Empty array means staff can work at all locations.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staffId = parseId((await params).id);
  if (!staffId) return NextResponse.json({ error: "Invalid staff id" }, { status: 400 });

  const db = bizDb(session.businessId);
  if (!(await staffWorksAt(db, staffId))) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  }

  try {
    const { data, error } = await supabase
      .from("staff_locations")
      .select("location_id")
      .eq("staff_id", staffId);
    if (error) throw error;

    const locationIds = (data ?? []).map((r) => r.location_id).filter((id): id is number => id !== null);
    return NextResponse.json({ locationIds });
  } catch (error) {
    console.error("Get staff locations error:", error);
    return NextResponse.json({ error: "Failed to load staff locations" }, { status: 500 });
  }
}

/**
 * POST /api/staff/[id]/locations — Assign staff to a location.
 * Body: { location_id: number }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staffId = parseId((await params).id);
  if (!staffId) return NextResponse.json({ error: "Invalid staff id" }, { status: 400 });

  const db = bizDb(session.businessId);
  if (!(await staffWorksAt(db, staffId))) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const locationId = Number(body.location_id);
    if (!Number.isInteger(locationId) || locationId <= 0) {
      return NextResponse.json({ error: "location_id must be a positive integer" }, { status: 400 });
    }

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

    // Insert or ignore if already assigned
    const { error } = await supabase
      .from("staff_locations")
      .insert({ staff_id: staffId, location_id: locationId })
      .select()
      .single();
    if (error) {
      // Ignore duplicate key errors; it means the assignment already exists
      if (!error.message.includes("duplicate")) throw error;
    }

    return NextResponse.json({ success: true, staffId, locationId }, { status: 201 });
  } catch (error) {
    console.error("Assign staff location error:", error);
    const message = error instanceof Error ? error.message : "Failed to assign location";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
