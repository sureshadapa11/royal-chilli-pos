import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "hr", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { data, error } = await db.from("payroll_periods").select("*").order("period_start", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch periods" }, { status: 500 });
  return NextResponse.json({ periods: data });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "hr", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { period_start, period_end } = await req.json();
    if (!period_start || !period_end) {
      return NextResponse.json({ error: "period_start and period_end are required" }, { status: 400 });
    }
    const { data, error } = await db
      .from("payroll_periods")
      .insert({ period_start, period_end })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, period: data }, { status: 201 });
  } catch (error) {
    console.error("Payroll period create error:", error);
    const message = error instanceof Error && error.message.includes("duplicate") ? "A period with these dates already exists" : "Failed to create period";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
