import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { areaAllows } from "@/lib/permissions";
import { maskHrDetails } from "@/lib/hr";

const EDITABLE_FIELDS = [
  "preferred_name", "job_title", "department", "employment_status", "contract_type",
  "working_pattern", "fixed_term_end_date", "contracted_hours_per_week",
  "rtw_evidence_method", "rtw_share_code", "rtw_time_limited", "rtw_permission_expiry_date",
  "rtw_has_restrictions", "rtw_restrictions_details", "rtw_is_student", "rtw_student_dates_provided",
  "rtw_sponsorship_now", "rtw_sponsorship_future",
  "ni_number", "p45_available", "hmrc_starter_checklist",
  "bank_account_name", "bank_name", "sort_code", "account_number",
  "emergency_contact_relationship", "emergency_contact_email",
  "reasonable_adjustment_needed", "reasonable_adjustment_details",
  "doc_id_rtw_supplied", "doc_p45_or_starter_supplied", "doc_quals_supplied", "doc_bank_supplied", "doc_other",
  "declaration_confirmed_accurate", "declaration_will_report_changes", "declaration_read_privacy",
  "declaration_signature", "declaration_date",
] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

  const { data: staffRow, error: staffErr } = await supabase
    .from("staff")
    .select("id, name, employee_number, role, hire_date, email, phone, address, date_of_birth, emergency_contact_name, emergency_contact_phone")
    .eq("id", staffId)
    .single();
  if (staffErr || !staffRow) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data: details } = await supabase.from("staff_hr_details").select("*").eq("staff_id", staffId).maybeSingle();

  return NextResponse.json({
    staff: staffRow,
    details: details ? maskHrDetails(details) : null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const body = await req.json();

  const update: Record<string, unknown> = { staff_id: Number(staffId), updated_at: new Date().toISOString() };
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field] === "" ? null : body[field];
  }

  const { data, error } = await supabase
    .from("staff_hr_details")
    .upsert(update, { onConflict: "staff_id" })
    .select()
    .single();
  if (error) {
    console.error("HR details save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    business_id: session.businessId,
    staff_id: session.id,
    action: "update",
    entity_type: "staff_hr_details",
    entity_id: Number(staffId),
    changes: { fields: Object.keys(body) },
  });

  return NextResponse.json({ success: true, details: maskHrDetails(data) });
}
