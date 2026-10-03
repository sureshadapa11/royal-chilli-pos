import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { staffIdsAt } from "@/lib/business";
import { canManageStaff } from "@/lib/permissions";
import { getBusinessSetting } from "@/lib/business-settings";
import { locationIdsByStaff } from "@/lib/locations";

const PROFILE_FIELDS =
  "id, name, username, role, active, employee_number, email, phone, address, date_of_birth, hire_date, employment_type, pay_rate, pay_frequency, emergency_contact_name, emergency_contact_phone, notes, vehicle_type, vehicle_registration, driver_status, created_at";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const role = searchParams.get("role");
  const activeParam = searchParams.get("active") ?? "1";

  let query = supabase.from("staff").select(PROFILE_FIELDS).in("id", await staffIdsAt(session.businessId)).order("name");

  if (activeParam !== "all") {
    query = query.eq("active", Number(activeParam));
  }
  if (role) {
    query = query.eq("role", role);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,employee_number.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 });
  }
  try {
    const locations = await locationIdsByStaff((data ?? []).map((e) => e.id));
    return NextResponse.json({ employees: (data ?? []).map((e) => ({ ...e, location_ids: locations.get(e.id) ?? [] })) });
  } catch {
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canManageStaff(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, username, password, role, ...profile } = body;
    if (!name || !username || !password || !role) {
      return NextResponse.json({ error: "Name, username, password, and role are required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const { data: existingUsername } = await supabase.from("staff").select("id").eq("username", username.toLowerCase()).maybeSingle();
    if (existingUsername) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 400 });
    }

    const { count: activeCount } = await supabase.from("staff").select("*", { count: "exact", head: true }).eq("active", 1).eq("business_id", session.businessId);
    const limitSetting = await getBusinessSetting(session.businessId, "max_employees");
    const maxEmployees = limitSetting != null ? Number(limitSetting) : null;
    if (maxEmployees !== null && (activeCount ?? 0) >= maxEmployees) {
      return NextResponse.json({ error: `Employee limit reached (${maxEmployees}). Increase it in Settings or deactivate an existing employee first.` }, { status: 400 });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const { data: created, error: insertErr } = await supabase
      .from("staff")
      .insert({
        // Staff belong to the business that adds them (each business is independent).
        business_id: session.businessId,
        name,
        username: username.toLowerCase(),
        password_hash,
        role,
        active: 1,
        email: profile.email || null,
        phone: profile.phone || null,
        address: profile.address || null,
        date_of_birth: profile.date_of_birth || null,
        hire_date: profile.hire_date || null,
        employment_type: profile.employment_type || "hourly",
        pay_rate: profile.pay_rate || 0,
        pay_frequency: profile.pay_frequency || "weekly",
        emergency_contact_name: profile.emergency_contact_name || null,
        emergency_contact_phone: profile.emergency_contact_phone || null,
        notes: profile.notes || null,
        vehicle_type: profile.vehicle_type || null,
        vehicle_registration: profile.vehicle_registration || null,
        driver_status: role === "driver" ? (profile.driver_status || "offline") : null,
      })
      .select(PROFILE_FIELDS)
      .single();
    if (insertErr) throw insertErr;

    const employee_number = `RC-EMP-${String(created.id).padStart(4, "0")}`;
    const { data: updated, error: updateErr } = await supabase
      .from("staff")
      .update({ employee_number })
      .eq("id", created.id)
      .select(PROFILE_FIELDS)
      .single();
    if (updateErr) throw updateErr;

    await supabase.from("audit_logs").insert({
      business_id: session.businessId,
      staff_id: session.id,
      action: "create",
      entity_type: "employee",
      entity_id: created.id,
      changes: { name, role },
    });

    return NextResponse.json({ success: true, employee: updated }, { status: 201 });
  } catch (error) {
    console.error("Employee create error:", error);
    const message = error instanceof Error ? error.message : "Failed to create employee";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
