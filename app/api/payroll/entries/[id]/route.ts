import { NextRequest, NextResponse } from "next/server";
import { bizDb, payrollEntryOwned } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { computeGrossPay } from "@/lib/payroll";

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
    if (!(await payrollEntryOwned(db, id))) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    const { bonuses, tips, deductions, holiday_pay, notes } = await req.json();

    const { data: existing, error: fetchErr } = await db.from("payroll_entries").select("*").eq("id", id).single();
    if (fetchErr || !existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    if (existing.status === "paid") {
      return NextResponse.json({ error: "Cannot edit a fully paid entry" }, { status: 400 });
    }

    const updated = {
      bonuses: bonuses ?? existing.bonuses,
      tips: tips ?? existing.tips,
      deductions: deductions ?? existing.deductions,
      holiday_pay: holiday_pay ?? existing.holiday_pay,
      notes: notes !== undefined ? notes : existing.notes,
    };
    const grossPay = computeGrossPay({ base_pay: existing.base_pay, ...updated });
    const status = existing.paid_amount >= grossPay && grossPay > 0 ? "paid" : existing.paid_amount > 0 ? "partially_paid" : "pending";

    const { data, error } = await db
      .from("payroll_entries")
      .update({ ...updated, gross_pay: grossPay, status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, entry: data });
  } catch (error) {
    console.error("Payroll entry update error:", error);
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
  }
}
