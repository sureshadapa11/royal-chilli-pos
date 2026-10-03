import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "hr", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const { status } = await req.json();
    if (status !== "approved" && status !== "rejected") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const { data, error } = await db
      .from("leave_requests")
      .update({ status, decided_by: session.id, decided_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    await db.from("audit_logs").insert({
      staff_id: session.id,
      action: status,
      entity_type: "leave_request",
      entity_id: Number(id),
      changes: { status },
    });

    return NextResponse.json({ success: true, leaveRequest: data });
  } catch (error) {
    console.error("Leave decision error:", error);
    return NextResponse.json({ error: "Failed to record decision" }, { status: 500 });
  }
}
