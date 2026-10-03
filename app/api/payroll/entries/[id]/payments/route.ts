import { NextRequest, NextResponse } from "next/server";
import { bizDb, payrollEntryOwned } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;
  if (!(await payrollEntryOwned(db, id))) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  const { data, error } = await db.from("payroll_payments").select("*").eq("payroll_entry_id", id).order("paid_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
  return NextResponse.json({ payments: data });
}

export async function POST(
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
    if (!(await payrollEntryOwned(db, id))) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    const body = await req.json();

    const { data: entry, error: fetchErr } = await db.from("payroll_entries").select("*").eq("id", id).single();
    if (fetchErr || !entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const remaining = Math.round((entry.gross_pay - entry.paid_amount) * 100) / 100;
    if (remaining <= 0) return NextResponse.json({ error: "This entry is already fully paid" }, { status: 400 });

    const amount = body.full ? remaining : Math.round(Number(body.amount) * 100) / 100;
    if (!amount || amount <= 0) return NextResponse.json({ error: "A positive amount is required" }, { status: 400 });
    if (amount > remaining + 0.01) {
      return NextResponse.json({ error: `Amount exceeds the remaining balance of £${remaining.toFixed(2)}` }, { status: 400 });
    }

    const { data: payment, error: payErr } = await db
      .from("payroll_payments")
      .insert({ payroll_entry_id: Number(id), amount, method: body.method || null, recorded_by: session.id, notes: body.notes || null })
      .select()
      .single();
    if (payErr) throw payErr;

    const newPaidAmount = Math.round((entry.paid_amount + amount) * 100) / 100;
    const newStatus = newPaidAmount >= entry.gross_pay ? "paid" : "partially_paid";
    const { data: updatedEntry, error: updateErr } = await db
      .from("payroll_entries")
      .update({ paid_amount: newPaidAmount, status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    await db.from("audit_logs").insert({
      staff_id: session.id,
      action: "payment",
      entity_type: "payroll_entry",
      entity_id: Number(id),
      changes: { amount, method: body.method || null, new_status: newStatus },
    });

    return NextResponse.json({ success: true, payment, entry: updatedEntry }, { status: 201 });
  } catch (error) {
    console.error("Payroll payment error:", error);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}
