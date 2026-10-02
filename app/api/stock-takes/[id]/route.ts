import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canManageInventory } from "@/lib/permissions";
import { stockTakeForCaller } from "@/lib/stock-takes";

// The count sheet: every line with system vs counted qty (and variance, since
// it's a generated column so it's always live even before posting).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session || !canManageInventory(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = bizDb(session.businessId);
  const { id } = await params;

  const access = await stockTakeForCaller(session, id);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { stockTake } = access;

  const { data: lines, error: linesErr } = await db
    .from("stock_take_lines")
    .select("*, ingredient:ingredients(name, unit)")
    .eq("stock_take_id", id)
    .order("id");
  if (linesErr) return NextResponse.json({ error: "Failed to fetch stock take lines" }, { status: 500 });

  const flat = (lines || []).map((l) => {
    const { ingredient: i, ...rest } = l as typeof l & { ingredient: { name: string; unit: string } | null };
    return { ...rest, ingredient_name: i?.name ?? null, unit: i?.unit ?? null };
  });

  return NextResponse.json({ stockTake, lines: flat });
}
