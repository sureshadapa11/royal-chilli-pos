import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { awardPurchasePoints } from "@/lib/customers";
import { depleteStockForOrder } from "@/lib/inventory";
import { sendOrderPaymentReceipt } from "@/lib/orders";

// What the payments table accepts (payments_method_check). Pay Later has its
// own route and records no payment; loyalty/vouchers are discounts, not tenders.
const PAYMENT_METHODS = ["cash", "card", "card_online"] as const;

type PaymentResult = {
  outcome: "recorded" | "not_found" | "cancelled" | "already_paid" | "nothing_due" | "exceeds_balance";
  total?: number | string;
  amount_paid?: number | string;
  remaining?: number | string;
  fully_paid?: boolean;
  table_id?: number | null;
  customer_id?: number | null;
};

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

    if (!(PAYMENT_METHODS as readonly unknown[]).includes(method)) {
      return NextResponse.json(
        { error: `Payment method must be one of: ${PAYMENT_METHODS.join(", ")}` },
        { status: 400 }
      );
    }
    const amountNum = typeof amount === "number" ? amount : NaN;
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }
    for (const [label, v] of [["Tip", tip_amount], ["Change", change_given]] as const) {
      if (v != null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
        return NextResponse.json({ error: `${label} must be zero or more` }, { status: 400 });
      }
    }
    if (reference != null && typeof reference !== "string") {
      return NextResponse.json({ error: "Invalid reference" }, { status: 400 });
    }

    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const db = bizDb(session.businessId);

    // Records the payment with the order row locked (record_order_payment,
    // migration 095): two tills paying the same bill at once can't both get
    // past the balance check — the second waits, then sees the new balance.
    // The order is marked paid there too, once fully covered.
    const { data: rpcData, error: paymentError } = await supabase.rpc("record_order_payment", {
      p_business_id: session.businessId,
      p_order_id: Number(id),
      p_method: method,
      p_amount: Math.round(amountNum * 100) / 100,
      p_tip_amount: tip_amount || 0,
      p_change_given: change_given || 0,
      p_reference: reference || null,
      p_staff_id: session.id,
    });
    if (paymentError) throw paymentError;
    const result = rpcData as PaymentResult;

    switch (result.outcome) {
      case "not_found":
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      case "cancelled":
        return NextResponse.json({ error: "This order was cancelled" }, { status: 400 });
      case "already_paid":
      case "nothing_due":
        return NextResponse.json({ error: "Order already paid" }, { status: 400 });
      case "exceeds_balance":
        return NextResponse.json(
          { error: `Amount exceeds the remaining balance of £${Number(result.remaining ?? 0).toFixed(2)}` },
          { status: 400 }
        );
    }

    const isFullyPaid = result.fully_paid === true;
    if (isFullyPaid) {
      // Best-effort stock depletion from recipes — never let this affect
      // whether the payment itself succeeds.
      depleteStockForOrder(Number(id), session.id).catch((e) => console.error("Stock depletion failed for order", id, e));
    }

    // Merged/extra orders are paid in full alongside the primary one — record a real
    // payment row for each (previously they were marked paid with no payment history at all,
    // which would silently undercount cash/card totals in reporting).
    if (Array.isArray(extraOrderIds) && extraOrderIds.length > 0) {
      const { data: extraOrders } = await db.from("orders").select("id, total, amount_paid, customer_id").in("id", extraOrderIds);
      for (const extra of extraOrders || []) {
        const extraRemaining = Math.round((Number(extra.total) - Number(extra.amount_paid)) * 100) / 100;
        if (extraRemaining <= 0.01) continue;
        // p_amount null = whatever is still owed, read under the row lock.
        const { data: extraData, error: extraErr } = await supabase.rpc("record_order_payment", {
          p_business_id: session.businessId,
          p_order_id: extra.id,
          p_method: method,
          p_amount: null,
          p_tip_amount: 0,
          p_change_given: 0,
          p_reference: reference ? `${reference} (merged with #${id})` : `Merged with #${id}`,
          p_staff_id: session.id,
        });
        if (extraErr) throw extraErr;
        if ((extraData as PaymentResult).outcome !== "recorded") continue; // paid/cancelled meanwhile
        depleteStockForOrder(extra.id, session.id).catch((e) => console.error("Stock depletion failed for order", extra.id, e));
        // a member linked to the table earns on every round, not just the first
        if (extra.customer_id) await awardPurchasePoints(extra.customer_id, Number(extra.total), extra.id);
        waitUntil(sendOrderPaymentReceipt(extra.id));
      }
    }

    // Free the table only once the primary order is actually fully settled.
    if (isFullyPaid && result.table_id) {
      await supabase.from("restaurant_tables").update({ status: "available", self_order_enabled: false }).eq("id", result.table_id);
    }

    if (isFullyPaid && result.customer_id) {
      await awardPurchasePoints(result.customer_id, Number(result.total), Number(id));
    }

    // Fired after awardPurchasePoints (not alongside the stock-depletion
    // block above) specifically so the receipt can report the points this
    // order actually just earned, not a stale pre-award balance.
    if (isFullyPaid) {
      waitUntil(sendOrderPaymentReceipt(Number(id)));
    }

    const remainingAfter = Math.max(0, Math.round((Number(result.total) - Number(result.amount_paid)) * 100) / 100);
    return NextResponse.json({ success: true, fully_paid: isFullyPaid, remaining_balance: remainingAfter });
  } catch (error) {
    console.error("Payment error:", error);
    return NextResponse.json(
      { error: "Failed to process payment" },
      { status: 500 }
    );
  }
}
