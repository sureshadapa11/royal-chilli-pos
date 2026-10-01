import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { awardPurchasePoints } from "@/lib/customers";
import { depleteStockForOrder } from "@/lib/inventory";
import { sendOrderPaymentReceipt } from "@/lib/orders";

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
    const { method, amount, tip_amount, change_given, reference, extraOrderIds } = await req.json();

    if (!method || !amount) {
      return NextResponse.json(
        { error: "Payment method and amount required" },
        { status: 400 }
      );
    }

    const db = bizDb(session.businessId);
    const { data: order, error: fetchError } = await db
      .from("orders")
      .select("id, total, amount_paid, table_id, status, is_paid, customer_id")
      .eq("id", id)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.is_paid) {
      return NextResponse.json(
        { error: "Order already paid" },
        { status: 400 }
      );
    }

    const remainingBefore = Math.round((Number(order.total) - Number(order.amount_paid)) * 100) / 100;
    if (Number(amount) > remainingBefore + 0.01) {
      return NextResponse.json(
        { error: `Amount exceeds the remaining balance of £${remainingBefore.toFixed(2)}` },
        { status: 400 }
      );
    }

    // Record payment — the trigger on payments updates orders.amount_paid automatically.
    const { error: paymentError } = await db
      .from("payments")
      .insert({
        order_id: Number(id),
        method,
        amount,
        tip_amount: tip_amount || 0,
        change_given: change_given || 0,
        reference: reference || null,
        staff_id: session.id,
      });
    if (paymentError) throw paymentError;

    const { data: refreshed } = await db.from("orders").select("total, amount_paid").eq("id", id).single();
    const isFullyPaid = refreshed && Number(refreshed.amount_paid) >= Number(refreshed.total) - 0.01;

    if (isFullyPaid) {
      await db.from("orders").update({ status: "paid", updated_at: new Date().toISOString() }).eq("id", id);
      // Best-effort stock depletion from recipes — never let this affect
      // whether the payment itself succeeds.
      depleteStockForOrder(Number(id), session.id, session.businessId).catch((e) => console.error("Stock depletion failed for order", id, e));
    }

    // Merged/extra orders are paid in full alongside the primary one — record a real
    // payment row for each (previously they were marked paid with no payment history at all,
    // which would silently undercount cash/card totals in reporting).
    if (Array.isArray(extraOrderIds) && extraOrderIds.length > 0) {
      const { data: extraOrders } = await db.from("orders").select("id, total, amount_paid, customer_id").in("id", extraOrderIds);
      for (const extra of extraOrders || []) {
        const extraRemaining = Math.round((Number(extra.total) - Number(extra.amount_paid)) * 100) / 100;
        if (extraRemaining <= 0.01) continue;
        await db.from("payments").insert({
          order_id: extra.id, method, amount: extraRemaining, staff_id: session.id,
          reference: reference ? `${reference} (merged with #${id})` : `Merged with #${id}`,
        });
        await db.from("orders").update({ status: "paid", updated_at: new Date().toISOString() }).eq("id", extra.id);
        depleteStockForOrder(extra.id, session.id, session.businessId).catch((e) => console.error("Stock depletion failed for order", extra.id, e));
        // a member linked to the table earns on every round, not just the first
        if (extra.customer_id) await awardPurchasePoints(extra.customer_id, Number(extra.total), extra.id);
        waitUntil(sendOrderPaymentReceipt(session.businessId, extra.id));
      }
    }

    // Free the table only once the primary order is actually fully settled.
    if (isFullyPaid && order.table_id) {
      await db.from("restaurant_tables").update({ status: "available", self_order_enabled: false }).eq("id", order.table_id);
    }

    if (isFullyPaid && order.customer_id) {
      await awardPurchasePoints(order.customer_id, Number(order.total), order.id);
    }

    // Fired after awardPurchasePoints (not alongside the stock-depletion
    // block above) specifically so the receipt can report the points this
    // order actually just earned, not a stale pre-award balance.
    if (isFullyPaid) {
      waitUntil(sendOrderPaymentReceipt(session.businessId, Number(id)));
    }

    const remainingAfter = refreshed ? Math.max(0, Math.round((Number(refreshed.total) - Number(refreshed.amount_paid)) * 100) / 100) : 0;
    return NextResponse.json({ success: true, fully_paid: isFullyPaid, remaining_balance: remainingAfter });
  } catch (error) {
    console.error("Payment error:", error);
    return NextResponse.json(
      { error: "Failed to process payment" },
      { status: 500 }
    );
  }
}
