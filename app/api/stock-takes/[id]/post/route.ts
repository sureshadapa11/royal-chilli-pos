import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getSessionFromRequest } from "@/lib/auth";
import { canApproveStockTakes } from "@/lib/permissions";
import { stockTakeForCaller } from "@/lib/stock-takes";

// For every line with a non-zero variance, writes an 'adjustment' stock_movement
// so the ledger balance ends up equal to the physical count, values the variance
// at current cost, and locks the take. Only posted takes make the till
// reconciliation report trustworthy (it assumes the shelf and system already agree).
// Requires the take to already be 'submitted' — counting staff submit, a
// separate approve_stock_takes-permitted role posts, mirroring the org chart's
// split between who counts stock and who signs off on it.
//
// The posting itself is one database transaction (post_stock_take, migration
// 095): the status flips submitted → posted first, so a double-click, a retry
// or two approvers at once can only ever apply the adjustments once.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canApproveStockTakes(session.role)) {
      return NextResponse.json({ error: "You don't have permission to approve stock takes" }, { status: 403 });
    }
    const { id } = await params;

    const access = await stockTakeForCaller(session, id);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    if (access.stockTake.status !== "submitted") {
      return NextResponse.json({ error: `Stock take is ${access.stockTake.status}, not submitted` }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("post_stock_take", {
      p_business_id: session.businessId,
      p_stock_take_id: Number(id),
      p_staff_id: session.id,
    });
    if (error) throw error;
    const result = data as { outcome: string; status?: string; stock_take?: Record<string, unknown> };

    if (result.outcome === "not_found") return NextResponse.json({ error: "Stock take not found" }, { status: 404 });
    if (result.outcome !== "posted") {
      // Lost a race: someone else posted (or reopened) it in the meantime.
      return NextResponse.json({ error: `Stock take is ${result.status}, not submitted` }, { status: 409 });
    }

    return NextResponse.json({ success: true, stockTake: result.stock_take });
  } catch (error) {
    console.error("Stock take post error:", error);
    return NextResponse.json({ error: "Failed to post stock take" }, { status: 500 });
  }
}
