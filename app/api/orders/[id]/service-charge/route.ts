import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { recalcTotals } from "@/lib/order-totals";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { pct } = await req.json();
    if (pct === undefined || Number(pct) < 0 || Number(pct) > 100) {
      return NextResponse.json({ error: "pct must be between 0 and 100" }, { status: 400 });
    }

    const db = bizDb(session.businessId);
    const { data: order } = await db.from("orders").select("status, is_paid").eq("id", id).maybeSingle();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.is_paid) {
      return NextResponse.json({ error: "Cannot change the service charge on an order that's already fully paid" }, { status: 409 });
    }

    const { error } = await db.from("orders").update({ service_charge_pct: Number(pct) }).eq("id", id);
    if (error) throw error;

    await recalcTotals(id, session.businessId);

    const { data: updatedOrder } = await db.from("orders").select("*").eq("id", id).single();
    return NextResponse.json({ success: true, order: updatedOrder });
  } catch (error) {
    console.error("Service charge error:", error);
    return NextResponse.json({ error: "Failed to apply service charge" }, { status: 500 });
  }
}
