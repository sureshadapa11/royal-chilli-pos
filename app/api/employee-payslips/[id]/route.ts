import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

// PATCH { status: "paid" | "unpaid" } — flips the payment switch and stamps
// (or clears) paid_at in the same write, so there's never a paid payslip
// with no timestamp behind it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (body.status === "paid" || body.status === "unpaid") {
    patch.status = body.status;
    patch.paid_at = body.status === "paid" ? new Date().toISOString() : null;
  }
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { data, error } = await db.from("employee_payslips").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: "Failed to update payslip" }, { status: 500 });
  return NextResponse.json({ payslip: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;
  const { error } = await db.from("employee_payslips").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete payslip" }, { status: 500 });
  return NextResponse.json({ success: true });
}
