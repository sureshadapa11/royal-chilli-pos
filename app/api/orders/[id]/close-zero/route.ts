import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { depleteStockForOrder } from "@/lib/inventory";
import { sendOrderPaymentReceipt } from "@/lib/orders";
import { tillRequired } from "@/lib/till-device";
import { tableBillOrderIds } from "@/lib/order-totals";

// POST — "Close bill: nothing to pay". A bill brought to £0 by a reward code,
// points or a 100% discount has nothing to take, so the normal payment route
// (which needs a positive amount) can't settle it. This marks it paid, frees
// the table, takes the stock and prints the receipt — everything a payment
// does except points: nothing was paid, so nothing is earned.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const notTill = await tillRequired(req, session);
    if (notTill) return notTill;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const db = bizDb(session.businessId);
    const { data: order } = await db.from("orders").select("id, status, is_paid, total, amount_paid, table_id").eq("id", Number(id)).maybeSingle();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status === "cancelled") return NextResponse.json({ error: "This order was cancelled" }, { status: 400 });
    if (order.is_paid || order.status === "paid") return NextResponse.json({ error: "Order already paid" }, { status: 400 });

    // A table bill closes as a whole: every round must have nothing left to pay.
    const billIds = await tableBillOrderIds(order.id, session.businessId);
    const { data: rounds } = await db.from("orders").select("id, total, amount_paid").in("id", billIds);
    const owed = (rounds ?? []).reduce((s, r) => s + Number(r.total) - Number(r.amount_paid || 0), 0);
    if (owed > 0.009) return NextResponse.json({ error: "This bill still has something to pay" }, { status: 400 });

    // Only if nothing changed meanwhile (another till paying the same bill).
    const { data: closed } = await db.from("orders").update({ status: "paid", updated_at: new Date().toISOString() })
      .in("id", billIds).neq("status", "paid").neq("status", "cancelled").select("id");
    if (!closed?.length) return NextResponse.json({ error: "Order already paid" }, { status: 400 });

    if (order.table_id) {
      await supabase.from("restaurant_tables").update({ status: "available", self_order_enabled: false }).eq("id", order.table_id);
    }
    for (const c of closed) {
      waitUntil(depleteStockForOrder(c.id, session.id).catch((e) => console.error("Stock depletion failed for order", c.id, e)));
    }
    waitUntil(sendOrderPaymentReceipt(session.businessId, order.id));
    return NextResponse.json({ success: true, fully_paid: true, remaining_balance: 0 });
  } catch (error) {
    console.error("Close £0 bill error:", error);
    return NextResponse.json({ error: "Couldn't close the bill" }, { status: 500 });
  }
}
