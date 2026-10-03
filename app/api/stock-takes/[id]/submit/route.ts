import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { stockTakeForCaller } from "@/lib/stock-takes";

// Hands an open count over for approval — no ledger writes yet, just a
// status flip. Posting (which writes stock_movements) now only happens
// from the submitted state, via a separate approve_stock_takes-gated route.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = bizDb(session.businessId);
    const { id } = await params;

    const access = await stockTakeForCaller(session, id);
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
    const { stockTake } = access;
    if (stockTake.status !== "open") {
      return NextResponse.json({ error: `Stock take is already ${stockTake.status}` }, { status: 400 });
    }

    const { data: submitted, error: subErr } = await db
      .from("stock_takes")
      .update({ status: "submitted" })
      .eq("id", id)
      .eq("status", "open")
      .select()
      .maybeSingle();
    if (subErr) throw subErr;
    // Someone else moved it on between the read and this write.
    if (!submitted) return NextResponse.json({ error: "This stock take was just changed — refresh and try again" }, { status: 409 });

    return NextResponse.json({ success: true, stockTake: submitted });
  } catch (error) {
    console.error("Stock take submit error:", error);
    return NextResponse.json({ error: "Failed to submit stock take" }, { status: 500 });
  }
}
