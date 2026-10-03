import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { staffIdsAt } from "@/lib/business";
import { bizDb, staffWorksAt } from "@/lib/business-db";
import { canEdit } from "@/lib/permissions";
import { findStaffByPin, hashPin, PIN_PATTERN } from "@/lib/staff-pin";

// GET — whether any till PINs exist yet. The till only locks once at least
// one is set, so switching the feature on can't lock everyone out.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { count } = await supabase.from("staff").select("id", { count: "exact", head: true }).eq("active", 1).not("pin_hash", "is", null).in("id", await staffIdsAt(session.businessId));
  return NextResponse.json({ pins_set: count ?? 0 });
}

// POST { staff_id, pin } — a manager sets a staff member's 4-digit till PIN
// (Staff Hub → HR). PINs must be unique: the till identifies people by PIN
// alone. pin: null removes it.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  // Set in Staff Hub → HR, so it needs full HR & Payroll access.
  if (!session || !canEdit(session.role, "hr")) {
    return NextResponse.json({ error: "Only HR or a Super admin can set PINs" }, { status: 401 });
  }
  const { staff_id, pin } = await req.json().catch(() => ({}));
  const staffId = Number(staff_id);
  if (!Number.isInteger(staffId) || staffId <= 0) return NextResponse.json({ error: "staff_id is required" }, { status: 400 });
  if (!(await staffWorksAt(bizDb(session.businessId), staffId))) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });

  if (pin === null) {
    await supabase.from("staff").update({ pin_hash: null }).eq("id", staffId);
    return NextResponse.json({ success: true });
  }
  const p = String(pin ?? "");
  if (!PIN_PATTERN.test(p)) return NextResponse.json({ error: "The PIN must be exactly 4 digits" }, { status: 400 });
  if (await findStaffByPin(p, session.businessId, staffId)) {
    return NextResponse.json({ error: "Someone else already uses that PIN — choose a different one" }, { status: 409 });
  }

  const { error } = await supabase.from("staff").update({ pin_hash: await hashPin(p) }).eq("id", staffId);
  if (error) return NextResponse.json({ error: "Failed to save PIN" }, { status: 500 });
  return NextResponse.json({ success: true });
}
