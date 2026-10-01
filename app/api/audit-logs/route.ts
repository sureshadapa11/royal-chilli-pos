import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";
import { bizDb } from "@/lib/business-db";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageStaff(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);

  const { data, error } = await bizDb(session.businessId)
    .from("audit_logs")
    .select("*, staff:staff!audit_logs_staff_id_fkey(name, role)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("Audit log fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
  }

  const flat = (data || []).map((r) => {
    const { staff: s, ...rest } = r as typeof r & { staff: { name: string; role: string } | null };
    return { ...rest, staff_name: s?.name ?? "System", staff_role: s?.role ?? null };
  });
  return NextResponse.json({ logs: flat });
}
