import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { STOCK_TAKE_REASON_CODES, stockTakeForCaller } from "@/lib/stock-takes";

type LineInput = { ingredient_id: unknown; counted_qty: unknown; reason_code?: unknown };

// Enter counted quantities (and optional reason) while a take is still open.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;
    const { lines } = await req.json(); // [{ ingredient_id, counted_qty, reason_code? }]
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "lines is required" }, { status: 400 });
    }
    // Counts are quantities in the ingredient's unit (kg, litres, each…), so
    // fractions are fine — but never negative, NaN or Infinity.
    for (const line of lines as LineInput[]) {
      if (!line || !Number.isInteger(Number(line.ingredient_id)) || Number(line.ingredient_id) <= 0) {
        return NextResponse.json({ error: "Each line needs a valid ingredient_id" }, { status: 400 });
      }
      if (line.counted_qty !== null) {
        const qty = typeof line.counted_qty === "number" ? line.counted_qty : NaN;
        if (!Number.isFinite(qty) || qty < 0) {
          return NextResponse.json({ error: "Counted quantities must be zero or more" }, { status: 400 });
        }
      }
      if (line.reason_code != null && line.reason_code !== "" && !(STOCK_TAKE_REASON_CODES as readonly unknown[]).includes(line.reason_code)) {
        return NextResponse.json({ error: `Reason must be one of: ${STOCK_TAKE_REASON_CODES.join(", ")}` }, { status: 400 });
      }
    }

    const access = await stockTakeForCaller(session, id);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    const { stockTake } = access;
    if (stockTake.status !== "open") {
      return NextResponse.json({ error: `Cannot edit counts on a ${stockTake.status} stock take` }, { status: 400 });
    }

    for (const line of lines as LineInput[]) {
      const { error } = await db
        .from("stock_take_lines")
        .update({ counted_qty: line.counted_qty, reason_code: line.reason_code || null })
        .eq("stock_take_id", id)
        .eq("ingredient_id", Number(line.ingredient_id));
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stock take line update error:", error);
    return NextResponse.json({ error: "Failed to update stock take lines" }, { status: 500 });
  }
}
