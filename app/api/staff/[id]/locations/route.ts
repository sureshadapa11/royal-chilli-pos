import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";
import { allOwned, bizDb, staffWorksAt } from "@/lib/business-db";
import { staffLocationIds } from "@/lib/locations";
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

/**
 * PATCH /api/staff/[id]/locations — Replace a staff member's location assignments.
 * Body: { location_ids: number[] } — an empty array unassigns them (they can
 * then work at every location).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  let body: { location_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = body?.location_ids;
  if (!Array.isArray(raw) || raw.some((id) => !Number.isInteger(id) || (id as number) <= 0)) {
    return NextResponse.json({ error: "location_ids must be an array of positive integers" }, { status: 400 });
  }
  const next = [...new Set(raw as number[])].sort((a, b) => a - b);

  try {
    if (!(await allOwned(db, "locations", next))) {
      return NextResponse.json({ error: "Every location must belong to this business" }, { status: 400 });
    }

    const current = (await staffLocationIds(staffId)).sort((a, b) => a - b);

    if (staffId === session.id && current.length > 0 && next.length === 0) {
      return NextResponse.json({ error: "You must keep at least one location" }, { status: 400 });
    }

    const toAdd = next.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !next.includes(id));

    // A manager limited to some locations can only hand out (or take away)
    // those locations — never widen anyone's access, their own included.
    if (!session.owner) {
      const own = await staffLocationIds(session.id);
      if (own.length > 0 && [...toAdd, ...toRemove].some((id) => !own.includes(id))) {
        return NextResponse.json({ error: "You can only assign locations you work at" }, { status: 403 });
      }
    }

    if (toRemove.length > 0) {
      const { error } = await supabase.from("staff_locations").delete().eq("staff_id", staffId).in("location_id", toRemove);
      if (error) throw error;
    }
    if (toAdd.length > 0) {
      const { error } = await supabase.from("staff_locations").insert(toAdd.map((location_id) => ({ staff_id: staffId, location_id })));
      if (error) throw error;
    }

    const { error: auditError } = await db.from("audit_logs").insert({
      staff_id: session.id,
      action: "staff_location_assignment",
      entity_type: "staff",
      entity_id: staffId,
      changes: { from: current, to: next },
    });
    if (auditError) console.error("Staff location audit log error:", auditError);

    const { data: staff, error: staffError } = await supabase.from("staff").select("id, name").eq("id", staffId).single();
    if (staffError) throw staffError;

    return NextResponse.json({ success: true, staff: { id: staff.id, name: staff.name, location_ids: next } });
  } catch (error) {
    console.error("Update staff locations error:", error);
    return NextResponse.json({ error: "Failed to update staff locations" }, { status: 500 });
  }
}
