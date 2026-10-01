import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { canManageStaff } from "@/lib/permissions";

// History, not a single editable record — see migration 019 for why.
export async function GET(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const { data, error } = await supabase
    .from("staff_rtw_verification")
    .select("*, checker:staff!staff_rtw_verification_checked_by_fkey(name)")
    .eq("staff_id", staffId)
    .order("check_date", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch RTW checks" }, { status: 500 });

  const flat = (data || []).map((r) => {
    const { checker: c, ...rest } = r as typeof r & { checker: { name: string } | null };
    return { ...rest, checked_by_name: c?.name ?? null };
  });
  return NextResponse.json({ checks: flat });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const body = await req.json();

  if (!body.check_date || !body.check_method) {
    return NextResponse.json({ error: "check_date and check_method are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("staff_rtw_verification")
    .insert({
      staff_id: Number(staffId),
      check_date: body.check_date,
      check_method: body.check_method,
      identity_matched: body.identity_matched ?? null,
      documents_genuine_valid: body.documents_genuine_valid ?? null,
      work_permitted: body.work_permitted ?? null,
      time_limited: body.time_limited ?? null,
      permission_expiry_date: body.permission_expiry_date || null,
      follow_up_due_date: body.follow_up_due_date || null,
      student_dates_retained: body.student_dates_retained || null,
      ecs_expiry_date: body.ecs_expiry_date || null,
      evidence_stored_securely: body.evidence_stored_securely ?? false,
      storage_location: body.storage_location || null,
      retention_reminder_recorded: body.retention_reminder_recorded ?? false,
      restrictions_communicated: body.restrictions_communicated || null,
      document_reference: body.document_reference || null,
      checked_by: session.id,
      checked_by_position: body.checked_by_position || null,
      employer_declaration_confirmed: body.employer_declaration_confirmed ?? false,
      signed_by: body.signed_by || null,
      signed_date: body.signed_date || null,
    })
    .select()
    .single();
  if (error) {
    console.error("RTW verification save error:", error);
    return NextResponse.json({ error: "Failed to save RTW check" }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    business_id: session.businessId,
    staff_id: session.id,
    action: "create",
    entity_type: "staff_rtw_verification",
    entity_id: data.id,
    changes: { staff_id: Number(staffId), check_method: body.check_method },
  });

  return NextResponse.json({ success: true, check: data }, { status: 201 });
}
