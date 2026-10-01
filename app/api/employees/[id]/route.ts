import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { canManageStaff } from "@/lib/permissions";
import { staffLocationIds } from "@/lib/locations";

const PROFILE_FIELDS =
  "id, name, username, role, active, employee_number, email, phone, address, date_of_birth, hire_date, employment_type, pay_rate, pay_frequency, emergency_contact_name, emergency_contact_phone, notes, vehicle_type, vehicle_registration, driver_status, created_at";

const EDITABLE_FIELDS = [
  "name", "username", "role", "email", "phone", "address", "date_of_birth", "hire_date",
  "employment_type", "pay_rate", "pay_frequency", "emergency_contact_name",
  "emergency_contact_phone", "notes", "active", "vehicle_type", "vehicle_registration", "driver_status",
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), id))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const { data, error } = await supabase.from("staff").select(PROFILE_FIELDS).eq("id", id).single();
  if (error || !data) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  try {
    const location_ids = (await staffLocationIds(data.id)).sort((a, b) => a - b);
    return NextResponse.json({ employee: { ...data, location_ids } });
  } catch {
    return NextResponse.json({ error: "Failed to load employee locations" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canManageStaff(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    if (!(await staffWorksAt(bizDb(session.businessId), id))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    const body = await req.json();

    // Role, active status and password resets are privilege-affecting — a
    // manager/hr session must not be able to promote themselves (or anyone
    // else) to admin, deactivate another account, or reset someone else's
    // password. Only admin may touch these; the rest of EDITABLE_FIELDS
    // (contact info, pay rate, etc.) stays open to any canManageStaff role.
    const RESTRICTED_FIELDS = new Set(["role", "active", "password"]);
    const touchesRestrictedField = Object.keys(body).some((k) => RESTRICTED_FIELDS.has(k));
    if (touchesRestrictedField && session.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can change role, active status or reset a password" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }
    if (typeof updates.username === "string") {
      updates.username = updates.username.toLowerCase();
      const { data: existingUsername } = await supabase
        .from("staff").select("id").eq("username", updates.username).neq("id", id).maybeSingle();
      if (existingUsername) {
        return NextResponse.json({ error: "That username is already taken" }, { status: 400 });
      }
    }
    if (body.password) {
      if (body.password.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
      }
      updates.password_hash = await bcrypt.hash(body.password, 10);
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("staff")
      .update(updates)
      .eq("id", id)
      .select(PROFILE_FIELDS)
      .single();
    if (error) throw error;

    // Never write the password hash itself into the audit trail.
    const { password_hash: _omit, ...auditableChanges } = updates;
    await supabase.from("audit_logs").insert({
      staff_id: session.id,
      action: "update",
      entity_type: "employee",
      entity_id: Number(id),
      changes: auditableChanges,
    });

    return NextResponse.json({ success: true, employee: data });
  } catch (error) {
    console.error("Employee update error:", error);
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 });
  }
}
