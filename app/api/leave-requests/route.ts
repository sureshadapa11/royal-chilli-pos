import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = bizDb(session.businessId);

  const isManager = areaAllows(session.role, "hr", req.method);
  let query = db
    .from("leave_requests")
    .select("*, staff:staff!leave_requests_staff_id_fkey(name)")
    .order("start_date", { ascending: false });
  if (!isManager) query = query.eq("staff_id", session.id);

  const { data, error } = await query;
  if (error) {
    console.error("Leave requests fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch leave requests" }, { status: 500 });
  }
  const flat = (data || []).map((r) => {
    const { staff: s, ...rest } = r as typeof r & { staff: { name: string } | null };
    return { ...rest, staff_name: s?.name ?? null };
  });
  return NextResponse.json({ leaveRequests: flat });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = bizDb(session.businessId);

    const { leave_type, start_date, end_date, reason } = await req.json();
    if (!leave_type || !start_date || !end_date) {
      return NextResponse.json({ error: "leave_type, start_date and end_date are required" }, { status: 400 });
    }

    const { data, error } = await db
      .from("leave_requests")
      .insert({ staff_id: session.id, leave_type, start_date, end_date, reason: reason || null, status: "pending" })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, leaveRequest: data }, { status: 201 });
  } catch (error) {
    console.error("Leave request create error:", error);
    return NextResponse.json({ error: "Failed to submit leave request" }, { status: 500 });
  }
}
