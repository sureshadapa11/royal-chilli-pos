import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { canManageStaff } from "@/lib/permissions";
import { MASKED_HR_FIELDS, type MaskedHrField } from "@/lib/hr";

// Every reveal of a bank/NI field is audit-logged — this is the one place
// the full unmasked value ever leaves the server.
export async function POST(req: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { staffId } = await params;
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const { field } = await req.json();

  if (!MASKED_HR_FIELDS.includes(field as MaskedHrField)) {
    return NextResponse.json({ error: "That field can't be revealed" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("staff_hr_details")
    .select(field)
    .eq("staff_id", staffId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });

  await supabase.from("audit_logs").insert({
    business_id: session.businessId,
    staff_id: session.id,
    action: "reveal_sensitive_field",
    entity_type: "staff_hr_details",
    entity_id: Number(staffId),
    changes: { field },
  });

  return NextResponse.json({ value: (data as Record<string, unknown> | null)?.[field] ?? null });
}
