import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { staffIdsAt } from "@/lib/business";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { computeHoursForPeriod } from "@/lib/payroll";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "reports", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });

  const { data: staff, error: staffErr } = await db.from("staff").select("id, name, role, pay_rate").eq("active", 1).in("id", await staffIdsAt(session.businessId)).order("name");
  if (staffErr) return NextResponse.json({ error: "Failed to fetch staff" }, { status: 500 });

  const hoursByStaff = await computeHoursForPeriod(session.businessId, from, to);

  const { data: lateCounts } = await db
    .from("attendance")
    .select("staff_id, late_seconds")
    .gte("work_date", from)
    .lte("work_date", to)
    .gt("late_seconds", 0);
  const lateByStaff = new Map<number, number>();
  for (const l of lateCounts || []) lateByStaff.set(l.staff_id, (lateByStaff.get(l.staff_id) || 0) + 1);

  // Labour cost = hours worked x current pay rate, computed live — not a
  // lookup into payroll_entries, which only has rows once a pay period has
  // actually been run (and would silently show £0 for everyone until then,
  // even with real hours and a real rate sitting right next to it).
  const rows = (staff || []).map((s) => {
    const hoursWorked = Math.round((hoursByStaff.get(s.id) || 0) * 100) / 100;
    const payRate = Number(s.pay_rate ?? 0);
    return {
      staff_id: s.id,
      name: s.name,
      role: s.role,
      hours_worked: hoursWorked,
      late_count: lateByStaff.get(s.id) || 0,
      pay_rate: payRate,
      labour_cost: Math.round(hoursWorked * payRate * 100) / 100,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({ hours: acc.hours + r.hours_worked, cost: acc.cost + r.labour_cost }),
    { hours: 0, cost: 0 }
  );

  return NextResponse.json({ rows, totals });
}
