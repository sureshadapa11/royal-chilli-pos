import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { areaAllows } from "@/lib/permissions";
import { applyPoAction } from "@/lib/purchase-orders-server";

// POST { action: submit | approve | reject | mark_sent | cancel, comment? }
// Who may do what, and from which stage, is in lib/purchase-orders.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session || !areaAllows(session.role, "inventory", req.method)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const poId = Number(id);
    if (!Number.isInteger(poId) || poId < 1) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    const { action, comment } = await req.json();
    const text = typeof comment === "string" ? comment.slice(0, 500) : null;

    const result = await applyPoAction(session, poId, String(action ?? ""), text);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, purchaseOrder: result.purchaseOrder });
  } catch (error) {
    console.error("Purchase order action error:", error);
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 });
  }
}
