import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { awardPurchasePoints } from "@/lib/customers";
import { depleteStockForOrder } from "@/lib/inventory";

const VALID_TRANSITIONS: Record<string, string[]> = {
  assigned: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
};

// A driver updates the status of their own assigned delivery.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { status } = await req.json();

    const db = bizDb(session.businessId);
    const { data: order, error: fetchErr } = await db.from("orders").select("driver_id, delivery_status").eq("id", id).single();
    if (fetchErr || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.driver_id !== session.id) return NextResponse.json({ error: "This delivery isn't assigned to you" }, { status: 403 });

    const allowed = VALID_TRANSITIONS[order.delivery_status || ""] || [];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: `Cannot move from ${order.delivery_status} to ${status}` }, { status: 400 });
    }

    if (status === "delivered") {
      // Cash on delivery is settled here: the cash still owed is recorded as
      // a real payment (reference 'delivery_cash') and the order marked
      // delivered + paid in one transaction (complete_delivery, migration 095)
      // — so a double tap can't collect twice, and the takings have an audit row.
      const { data: rpcData, error: rpcErr } = await supabase.rpc("complete_delivery", {
        p_business_id: session.businessId,
        p_order_id: Number(id),
        p_driver_id: session.id,
      });
      if (rpcErr) throw rpcErr;
      const result = rpcData as { outcome: string; delivery_status?: string; collected?: number | string; order?: Record<string, unknown> };
      switch (result.outcome) {
        case "not_found":
          return NextResponse.json({ error: "Order not found" }, { status: 404 });
        case "not_your_delivery":
          return NextResponse.json({ error: "This delivery isn't assigned to you" }, { status: 403 });
        case "cancelled":
          return NextResponse.json({ error: "This order was cancelled" }, { status: 400 });
        case "wrong_status":
          return NextResponse.json({ error: `Cannot move from ${result.delivery_status} to delivered` }, { status: 409 });
      }

      const delivered = result.order as { id: number; total: number | string; customer_id: number | null };
      // Same follow-ups as a till payment. Only when this delivery actually
      // collected the money — an order already paid online had them run by
      // the Stripe webhook. Depletion also guards itself per order.
      if (Number(result.collected) > 0) {
        waitUntil(depleteStockForOrder(delivered.id, session.id).catch((e) => console.error("Stock depletion failed for order", id, e)));
        if (delivered.customer_id) {
          waitUntil(awardPurchasePoints(delivered.customer_id, Number(delivered.total), delivered.id).catch((e) => console.error("Loyalty points failed for order", id, e)));
        }
      }

      return NextResponse.json({ success: true, order: delivered, collected: Number(result.collected) });
    }

    const { data, error } = await db
      .from("orders")
      .update({ delivery_status: status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("delivery_status", order.delivery_status)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "This delivery was just updated — refresh and try again" }, { status: 409 });

    return NextResponse.json({ success: true, order: data });
  } catch (error) {
    console.error("Delivery status error:", error);
    return NextResponse.json({ error: "Failed to update delivery status" }, { status: 500 });
  }
}
