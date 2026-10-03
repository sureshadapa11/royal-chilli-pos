import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { stockTakeForCaller } from "@/lib/stock-takes";

// Variance report: qty + value per line, plus a reason-code breakdown.
// 'unknown' is the shrinkage signal — over-portioning, untracked waste, or
// theft — trending its value over time is the single most useful number
// this module produces.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !areaAllows(session.role, "inventory", req.method)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;

  const access = await stockTakeForCaller(session, id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { stockTake } = access;

  const { data: lines, error: linesErr } = await db
    .from("stock_take_lines")
    .select("*, ingredient:ingredients(name, unit, cost_per_unit)")
    .eq("stock_take_id", id)
    .neq("variance_qty", 0);
  if (linesErr) return NextResponse.json({ error: "Failed to fetch variance" }, { status: 500 });

  const flat = (lines || []).map((l) => {
    const { ingredient: i, ...rest } = l as typeof l & { ingredient: { name: string; unit: string; cost_per_unit: number } | null };
    const value = l.variance_value ?? Math.round(Number(l.variance_qty) * Number(i?.cost_per_unit ?? 0) * 100) / 100;
    return { ...rest, ingredient_name: i?.name ?? null, unit: i?.unit ?? null, variance_value: value };
  });

  const byReason: Record<string, number> = {};
  for (const l of flat) {
    const key = l.reason_code || "uncategorised";
    byReason[key] = Math.round(((byReason[key] || 0) + Number(l.variance_value)) * 100) / 100;
  }

  const totalValue = Math.round(flat.reduce((s, l) => s + Number(l.variance_value), 0) * 100) / 100;

  return NextResponse.json({ stockTake, lines: flat, totalValue, byReason });
}
