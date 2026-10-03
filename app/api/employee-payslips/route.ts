import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { computeHoursForPeriod } from "@/lib/payroll";

// GET ?staff_id=123 — one employee's payslip history, latest first.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);

  const { searchParams } = new URL(req.url);
  const staffId = searchParams.get("staff_id");
  if (!staffId) return NextResponse.json({ error: "staff_id is required" }, { status: 400 });

  const { data, error } = await db
    .from("employee_payslips")
    .select("*")
    .eq("staff_id", Number(staffId))
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch payslips" }, { status: 500 });
  return NextResponse.json({ payslips: data });
}

// POST { staff_id, period_start, period_end } — pulls hours from locked
// timesheets (same source as the period-based Payroll) and the employee's
// current pay_rate, computes the total, and auto-names the payslip
// "<Month> <Year> - Payslip #<n>" where n counts this employee's payslips
// already created that month.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);

  const { staff_id, period_start, period_end } = await req.json();
  if (!staff_id || !period_start || !period_end) {
    return NextResponse.json({ error: "staff_id, period_start and period_end are required" }, { status: 400 });
  }
  if (period_end < period_start) {
    return NextResponse.json({ error: "period_end must be on or after period_start" }, { status: 400 });
  }

  const { data: staff, error: staffErr } = await db.from("staff").select("id, name, pay_rate").eq("id", staff_id).single();
  if (staffErr || !staff) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const hoursByStaff = await computeHoursForPeriod(session.businessId, period_start, period_end);
  const hoursWorked = Math.round((hoursByStaff.get(staff.id) || 0) * 100) / 100;
  const payRate = Number(staff.pay_rate || 0);
  const totalAmount = Math.round(hoursWorked * payRate * 100) / 100;

  // Auto-name: "<Month> <Year> - Payslip #<n>" — n = how many this employee
  // already has whose period_end falls in the same calendar month.
  const endDate = new Date(period_end + "T00:00:00Z");
  const monthLabel = endDate.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const yearLabel = endDate.getUTCFullYear();
  const monthStart = `${yearLabel}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const monthEndDate = new Date(Date.UTC(yearLabel, endDate.getUTCMonth() + 1, 0));
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const { count } = await db
    .from("employee_payslips")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staff.id)
    .gte("period_end", monthStart)
    .lte("period_end", monthEnd);
  const name = `${monthLabel} ${yearLabel} - Payslip #${(count ?? 0) + 1}`;

  const { data: saved, error } = await db
    .from("employee_payslips")
    .insert({
      staff_id: staff.id, name, period_start, period_end,
      hours_worked: hoursWorked, pay_rate: payRate, total_amount: totalAmount,
      status: "unpaid", created_by: session.id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Failed to create payslip" }, { status: 500 });
  return NextResponse.json({ payslip: saved }, { status: 201 });
}
