import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canApproveStockTakes } from "@/lib/permissions";

// For every line with a non-zero variance, writes an 'adjustment' stock_movement
// so the ledger balance ends up equal to the physical count, values the variance
// at current cost, and locks the take. Only posted takes make the till
// reconciliation report trustworthy (it assumes the shelf and system already agree).
// Requires the take to already be 'submitted' — counting staff submit, a
// separate approve_stock_takes-permitted role posts, mirroring the org chart's
// split between who counts stock and who signs off on it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !canApproveStockTakes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;

    const { data: stockTake, error: stErr } = await db.from("stock_takes").select("status, location_id").eq("id", id).single();
    if (stErr || !stockTake) return NextResponse.json({ error: "Stock take not found" }, { status: 404 });
    if (stockTake.status !== "submitted") {
      return NextResponse.json({ error: `Stock take is ${stockTake.status}, not submitted` }, { status: 400 });
    }

    const { data: lines, error: linesErr } = await db
      .from("stock_take_lines")
      .select("*, ingredient:ingredients(cost_per_unit)")
      .eq("stock_take_id", id);
    if (linesErr) throw linesErr;

    for (const line of lines || []) {
      const ing = (line as typeof line & { ingredient: { cost_per_unit: number } | null }).ingredient;
      if (line.counted_qty == null) continue; // never counted — leave uncounted, don't force a variance
      const varianceQty = Number(line.variance_qty);
      const varianceValue = Math.round(varianceQty * Number(ing?.cost_per_unit ?? 0) * 100) / 100;

      if (varianceQty !== 0) {
        const { error: moveErr } = await db.from("stock_movements").insert({
          ingredient_id: line.ingredient_id,
          movement_type: "adjustment",
          quantity_delta: varianceQty,
          reference_type: "stock_take",
          reference_id: Number(id),
          reason: line.reason_code || "count_error",
          staff_id: session.id,
          location_id: stockTake.location_id,
        });
        if (moveErr) throw moveErr;
      }

      const { error: updErr } = await db.from("stock_take_lines").update({ variance_value: varianceValue }).eq("id", line.id);
      if (updErr) throw updErr;
    }

    const { data: posted, error: postErr } = await db
      .from("stock_takes")
      .update({ status: "posted", posted_at: new Date().toISOString(), posted_by: session.id })
      .eq("id", id)
      .select()
      .single();
    if (postErr) throw postErr;

    return NextResponse.json({ success: true, stockTake: posted });
  } catch (error) {
    console.error("Stock take post error:", error);
    return NextResponse.json({ error: "Failed to post stock take" }, { status: 500 });
  }
}
