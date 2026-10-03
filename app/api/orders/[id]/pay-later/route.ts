import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { depleteStockForOrder } from "@/lib/inventory";

// Marks an order deferred instead of collecting payment — a card was
// declined, the customer forgot their wallet, whatever the reason. No
// payments row is inserted (no money changed hands) and the order's own
// status is left as-is; `pay_later` is a separate flag layered on top, kept
// true permanently even after eventual payment as a historical record.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { note, extraOrderIds } = await req.json().catch(() => ({}));

    const db = bizDb(session.businessId);
    const { data: order, error: fetchError } = await db
      .from("orders")
      .select("id, status, is_paid, table_id")
      .eq("id", id)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.is_paid) {
      return NextResponse.json({ error: "Order already paid" }, { status: 400 });
    }

    // Only this business's orders (merged-table extras included).
    const asked = [Number(id), ...(Array.isArray(extraOrderIds) ? extraOrderIds.map(Number) : [])];
    const { data: owned } = await db.from("orders").select("id").in("id", asked);
    const ids = (owned ?? []).map((o) => o.id as number);
    const { error: updateError } = await db
      .from("orders")
      .update({ pay_later: true, pay_later_note: note || null, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (updateError) throw updateError;

    // The food was still actually made and served — ingredients were
    // genuinely consumed — so stock depletes now, same as a real payment,
    // rather than waiting for money to eventually arrive.
    for (const orderId of ids) {
      depleteStockForOrder(orderId, session.id).catch((e) => console.error("Stock depletion failed for order", orderId, e));
    }

    // Free the table immediately — a blocked card can't hold it hostage;
    // the debt travels with the order, not the table.
    if (order.table_id) {
      await db.from("restaurant_tables").update({ status: "available", self_order_enabled: false }).eq("id", order.table_id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Pay-later error:", error);
    return NextResponse.json({ error: "Failed to mark order pay later" }, { status: 500 });
  }
}
