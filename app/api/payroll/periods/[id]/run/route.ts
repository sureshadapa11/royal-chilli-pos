import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { staffIdsAt } from "@/lib/business";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { computeHoursForPeriod, computeGrossPay } from "@/lib/payroll";

// Computes payroll_entries for every active employee from real attendance data.
// Safe to re-run on the same period — updates rather than duplicating (unless the entry is already paid).
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
    const { data: period, error: periodErr } = await db.from("payroll_periods").select("*").eq("id", id).single();
    if (periodErr || !period) return NextResponse.json({ error: "Period not found" }, { status: 404 });

    const hoursByStaff = await computeHoursForPeriod(session.businessId, period.period_start, period.period_end);

    const { data: staff, error: staffErr } = await db
      .from("staff")
      .select("id, pay_rate, employment_type")
      .eq("active", 1)
      .in("id", await staffIdsAt(session.businessId));
    if (staffErr) throw staffErr;

    const results = [];
    for (const s of staff || []) {
      const hoursWorked = Math.round((hoursByStaff.get(s.id) || 0) * 100) / 100;
      if (s.employment_type === "hourly" && hoursWorked === 0) continue; // nothing to pay this period

      const { data: existing } = await db
        .from("payroll_entries")
        .select("id, bonuses, tips, deductions, holiday_pay, paid_amount, status")
        .eq("payroll_period_id", id)
        .eq("staff_id", s.id)
        .maybeSingle();
      if (existing && existing.status === "paid") {
        results.push({ staff_id: s.id, skipped: "already fully paid" });
        continue;
      }

      const basePay = s.employment_type === "hourly"
        ? Math.round(hoursWorked * s.pay_rate * 100) / 100
        : Number(s.pay_rate);

      const bonuses = existing?.bonuses ?? 0;
      const tips = existing?.tips ?? 0;
      const deductions = existing?.deductions ?? 0;
      const holidayPay = existing?.holiday_pay ?? 0;
      const grossPay = computeGrossPay({ base_pay: basePay, bonuses, tips, deductions, holiday_pay: holidayPay });
      const paidAmount = existing?.paid_amount ?? 0;
      const status = paidAmount >= grossPay && grossPay > 0 ? "paid" : paidAmount > 0 ? "partially_paid" : "pending";

      const row = {
        payroll_period_id: Number(id),
        staff_id: s.id,
        hours_worked: hoursWorked,
        pay_rate: s.pay_rate,
        base_pay: basePay,
        bonuses, tips, deductions, holiday_pay: holidayPay,
        gross_pay: grossPay,
        paid_amount: paidAmount,
        status,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error: upsertErr } = await db
        .from("payroll_entries")
        .upsert(row, { onConflict: "payroll_period_id,staff_id" })
        .select()
        .single();
      if (upsertErr) throw upsertErr;
      results.push(saved);
    }

    if (period.status === "open") {
      await db.from("payroll_periods").update({ status: "processing" }).eq("id", id);
    }

    return NextResponse.json({ success: true, entries: results });
  } catch (error) {
    console.error("Run payroll error:", error);
    return NextResponse.json({ error: "Failed to run payroll" }, { status: 500 });
  }
}
