import { NextRequest, NextResponse } from "next/server";
import { canChangeAccess, canGiveRole } from "@/lib/roles";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { canManageStaff } from "@/lib/permissions";
import { staffLocationIds } from "@/lib/locations";

const PROFILE_FIELDS =
  "id, name, username, role, active, employee_number, email, phone, address, date_of_birth, hire_date, employment_type, pay_rate, pay_frequency, emergency_contact_name, emergency_contact_phone, notes, vehicle_type, vehicle_registration, driver_status, can_deliver, created_at";

const EDITABLE_FIELDS = [
  "name", "username", "role", "email", "phone", "address", "date_of_birth", "hire_date",
  "employment_type", "pay_rate", "pay_frequency", "emergency_contact_name",
  "emergency_contact_phone", "notes", "active", "vehicle_type", "vehicle_registration", "driver_status", "can_deliver",
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

    // Role, active status and password resets are privilege-affecting. Only
    // Super admin, Supervisor and HR may touch them, never on their own
    // account (unless Super admin), and only Super admin may edit the Super
    // admin account. Super admin is never given to anyone. The rest of
    // EDITABLE_FIELDS (contact info, pay rate, etc.) stays open to any
    // canManageStaff role.
    const { data: target } = await supabase.from("staff").select("role, active").eq("id", id).maybeSingle();
    if (target?.role === "admin" && session.role !== "admin") {
      return NextResponse.json({ error: "Only the Super admin can change the Super admin account" }, { status: 403 });
    }
    // Forms send the whole record — only an actual change counts.
    const touchesRestrictedField =
      ("role" in body && body.role !== target?.role) ||
      ("active" in body && Number(body.active) !== Number(target?.active)) ||
      (typeof body.password === "string" && body.password !== "");
    if (touchesRestrictedField && (!canChangeAccess(session.role) || (Number(id) === session.id && session.role !== "admin"))) {
      return NextResponse.json({ error: "Only the Super admin, a Supervisor or HR can change role, active status or reset a password" }, { status: 403 });
    }
    if ("role" in body && body.role !== target?.role && !canGiveRole(session.role, String(body.role))) {
      return NextResponse.json({ error: "You can't give that role" }, { status: 403 });
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
      business_id: session.businessId,
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
