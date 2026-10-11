import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { awardPurchasePoints } from "@/lib/customers";
import { depleteStockForOrder } from "@/lib/inventory";
import { sendOrderPaymentReceipt } from "@/lib/orders";
import { tillRequired } from "@/lib/till-device";
import { tableBillOrderIds } from "@/lib/order-totals";

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
    const notTill = await tillRequired(req, session);
    if (notTill) return notTill;

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

    // The bill being paid: this order, plus — for a table bill — its other
    // rounds (one order per Send to Kitchen; lib/order-totals.ts) and any
    // order the till merged in. Each round's total is its share of the bill,
    // so one payment is spread over them oldest first.
    const billIds = await tableBillOrderIds(Number(id), session.businessId);
    const extras = (Array.isArray(extraOrderIds) ? extraOrderIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const ids = [...new Set([Number(id), ...billIds, ...extras])];
    const { data: rows } = await db.from("orders").select("id, status, is_paid, total, amount_paid, table_id, customer_id, created_at").in("id", ids);
    const primary = (rows ?? []).find((o) => o.id === Number(id));
    if (!primary) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (primary.status === "cancelled") return NextResponse.json({ error: "This order was cancelled" }, { status: 400 });
    const owedOf = (o: { total: number | string; amount_paid: number | string | null }) => Math.max(0, Math.round((Number(o.total) - Number(o.amount_paid || 0)) * 100) / 100);
    const open = (rows ?? [])
      .filter((o) => o.status !== "cancelled" && !o.is_paid && o.status !== "paid")
      .sort((a, b) => (a.id === Number(id) ? -1 : b.id === Number(id) ? 1 : String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id));
    const owed = Math.round(open.reduce((t, o) => t + owedOf(o), 0) * 100) / 100;
    if (owed <= 0.009) return NextResponse.json({ error: "Order already paid" }, { status: 400 });
    if (amountNum > owed + 0.01) {
      return NextResponse.json({ error: `Amount exceeds the remaining balance of £${owed.toFixed(2)}` }, { status: 400 });
    }

    // Records each part with the order row locked (record_order_payment,
    // migration 095): two tills paying the same bill at once can't both get
    // past the balance check. The tip and change go on the first part.
    let left = Math.round(amountNum * 100) / 100;
    let first = true;
    const paidIds: number[] = [];
    const unpaidMergedOrders: number[] = [];
    for (const o of open) {
      const part = Math.min(left, owedOf(o));
      if (part <= 0.009) continue;
      const { data: rpcData, error: paymentError } = await supabase.rpc("record_order_payment", {
        p_business_id: session.businessId,
        p_order_id: o.id,
        p_method: method,
        p_amount: Math.round(part * 100) / 100,
        p_tip_amount: first ? tip_amount || 0 : 0,
        p_change_given: first ? change_given || 0 : 0,
        p_reference: o.id === Number(id) ? reference || null : reference ? `${reference} (bill #${id})` : `Bill #${id}`,
        p_staff_id: session.id,
      });
      if (paymentError) {
        // An earlier part is already saved, so never throw here: the till
        // would show "Failed" for money that was taken. Report it instead.
        if (first) throw paymentError;
        console.error("Payment failed for bill round", o.id, paymentError);
        unpaidMergedOrders.push(o.id);
        continue;
      }
      const result = rpcData as PaymentResult;
      if (result.outcome !== "recorded") {
        if (first) {
          switch (result.outcome) {
            case "not_found": return NextResponse.json({ error: "Order not found" }, { status: 404 });
            case "cancelled": return NextResponse.json({ error: "This order was cancelled" }, { status: 400 });
            case "exceeds_balance":
              return NextResponse.json({ error: `Amount exceeds the remaining balance of £${Number(result.remaining ?? 0).toFixed(2)}` }, { status: 400 });
            default: return NextResponse.json({ error: "Order already paid" }, { status: 400 });
          }
        }
        unpaidMergedOrders.push(o.id);
        continue;
      }
      first = false;
      left = Math.round((left - part) * 100) / 100;
      if (result.fully_paid) paidIds.push(o.id);
      if (left <= 0.009) break;
    }

    // Each fully paid round: stock, points (a member linked to the table
    // earns on every round), receipt — after the points, so it can show them.
    for (const o of open.filter((x) => paidIds.includes(x.id))) {
      waitUntil(depleteStockForOrder(o.id, session.id).catch((e) => console.error("Stock depletion failed for order", o.id, e)));
      const member = o.customer_id ?? primary.customer_id;
      if (member) await awardPurchasePoints(member, Number(o.total), o.id);
    }
    if (paidIds.length) waitUntil(sendOrderPaymentReceipt(session.businessId, paidIds.includes(Number(id)) ? Number(id) : paidIds[0]));

    const remainingAfter = Math.max(0, Math.round((owed - (Math.round(amountNum * 100) / 100 - left)) * 100) / 100);
    const isFullyPaid = remainingAfter <= 0.009 && unpaidMergedOrders.length === 0;

    // Free the table only once the whole bill is settled.
    if (isFullyPaid && primary.table_id) {
      await supabase.from("restaurant_tables").update({ status: "available", self_order_enabled: false }).eq("id", primary.table_id);
    }

    return NextResponse.json({ success: true, fully_paid: isFullyPaid, remaining_balance: remainingAfter, unpaid_merged_orders: unpaidMergedOrders });
  } catch (error) {
    console.error("Payment error:", error);
    return NextResponse.json(
      { error: "Failed to process payment" },
      { status: 500 }
    );
  }
}
