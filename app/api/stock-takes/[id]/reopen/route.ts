import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { canApproveStockTakes } from "@/lib/permissions";
import { stockTakeForCaller } from "@/lib/stock-takes";

// The approver's reject path: sends a submitted count back to 'open' for a
// recount instead of posting it. Counted quantities/reason codes are left
// as-is so the counting staff can review and correct rather than start over.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canApproveStockTakes(session.role)) {
      return NextResponse.json({ error: "You don't have permission to approve stock takes" }, { status: 403 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;

    const access = await stockTakeForCaller(session, id);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    const { stockTake } = access;
    if (stockTake.status !== "submitted") {
      return NextResponse.json({ error: `Stock take is ${stockTake.status}, not submitted` }, { status: 400 });
    }

    const { data: reopened, error: reopenErr } = await db
      .from("stock_takes")
      .update({ status: "open" })
      .eq("id", id)
      .eq("status", "submitted")
      .select()
      .maybeSingle();
    if (reopenErr) throw reopenErr;
    // Someone else moved it on between the read and this write.
    if (!reopened) return NextResponse.json({ error: "This stock take was just changed — refresh and try again" }, { status: 409 });

    return NextResponse.json({ success: true, stockTake: reopened });
  } catch (error) {
    console.error("Stock take reopen error:", error);
    return NextResponse.json({ error: "Failed to reopen stock take" }, { status: 500 });
  }
}
