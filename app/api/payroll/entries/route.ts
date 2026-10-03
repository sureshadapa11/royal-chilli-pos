import { NextRequest, NextResponse } from "next/server";
import { allOwned, bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = bizDb(session.businessId);

  const { searchParams } = new URL(req.url);
  const periodId = searchParams.get("period_id");
  if (!periodId) return NextResponse.json({ error: "period_id is required" }, { status: 400 });
  if (!(await allOwned(db, "payroll_periods", [periodId]))) return NextResponse.json({ error: "Pay period not found" }, { status: 404 });

  const isManager = areaAllows(session.role, "hr", req.method);
  let query = db
    .from("payroll_entries")
    .select("*, staff:staff!payroll_entries_staff_id_fkey(name)")
    .eq("payroll_period_id", periodId);
  if (!isManager) query = query.eq("staff_id", session.id);

  const { data, error } = await query;
  if (error) {
    console.error("Payroll entries fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 });
  }
  const flat = (data || []).map((e) => {
    const { staff: s, ...rest } = e as typeof e & { staff: { name: string } | null };
    return { ...rest, staff_name: s?.name ?? null };
  });
  return NextResponse.json({ entries: flat });
}
