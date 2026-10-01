import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { stripe } from "@/lib/stripe";
import { sendOrderConfirmationEmail } from "@/lib/email";
import { queueKitchenTicketSafely, printAfterFor } from "@/lib/print-queue";
import { awardPurchasePoints } from "@/lib/customers";
import { depleteStockForOrder } from "@/lib/inventory";

// Stripe is the source of truth for "did the payment actually succeed" — the
// browser redirect back to success_url is just a UX hint, never trusted on
// its own. This webhook is what actually marks things paid.
export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { type, order_id, reservation_id } = session.metadata || {};

    try {
      if (type === "order" && order_id) {
        const { data: order } = await supabase
          .from("orders")
          .select("business_id, order_number, order_type, subtotal, total, amount_paid, scheduled_for, customer_id, customer_name, customer_email, customer_address, customer_postcode")
          .eq("id", order_id).single();
        if (order) {
          const db = bizDb(Number(order.business_id));
          // Stripe can redeliver the same event (retries, manual resend) — guard
          // against inserting a second payment row for a session we've already
          // recorded, since there's no DB-level unique constraint on reference.
          const { data: existingPayment } = await db
            .from("payments").select("id").eq("order_id", Number(order_id)).eq("reference", session.id).maybeSingle();
          if (existingPayment || Number(order.amount_paid) >= Number(order.total)) {
            return NextResponse.json({ received: true });
          }
          const amount = (session.amount_total || 0) / 100;
          await db.from("payments").insert({
            order_id: Number(order_id),
            method: "card_online",
            amount,
            staff_id: null,
            reference: session.id,
          });

          // Fully paid online: the same follow-ups a till payment runs —
          // loyalty points for a signed-in customer and stock depletion —
          // which online payments used to skip. Inside the idempotency guard,
          // so a redelivered event can't award or deplete twice (depletion
          // also guards itself per order).
          if (Number(order.amount_paid) + amount >= Number(order.total) - 0.009) {
            const orderId = Number(order_id);
            if (order.customer_id) {
              waitUntil(awardPurchasePoints(order.customer_id, Number(order.total), orderId).catch((e) => console.error("Loyalty points failed for online order", orderId, e)));
            }
            waitUntil(depleteStockForOrder(orderId, null, Number(order.business_id)).catch((e) => console.error("Stock depletion failed for online order", orderId, e)));
          }

          // Pay-online orders only reach the kitchen printer once paid (the
          // order route skipped them) — inside the idempotency guard, so a
          // redelivered event can't print a second ticket.
          await queueKitchenTicketSafely(Number(order_id), "online", { printAfter: printAfterFor(order) });

          // First real confirmation this order gets — the order-creation
          // route deliberately skipped it for pay-online orders, since
          // "confirmed" wasn't true until this webhook fired.
          const { data: orderItems } = await db
            .from("order_items").select("item_name, quantity, item_price, notes").eq("order_id", order_id);
          waitUntil(sendOrderConfirmationEmail(order.customer_email, {
            orderNumber: order.order_number,
            customerName: order.customer_name,
            orderType: order.order_type,
            scheduledFor: order.scheduled_for,
            subtotal: Number(order.subtotal),
            deliveryFee: order.order_type === "delivery" ? Number(order.total) - Number(order.subtotal) : 0,
            discount: 0,
            total: Number(order.total),
            customerAddress:
              order.order_type === "delivery" && order.customer_address
                ? `${order.customer_address}, ${order.customer_postcode}`
                : null,
            paymentMethod: "Card, paid online",
            paymentStatus: "paid",
            items: (orderItems || []).map((i) => ({ name: i.item_name, quantity: i.quantity, unitPrice: i.item_price, notes: i.notes })),
          }));
        }
      } else if (type === "reservation" && reservation_id) {
        await supabase
          .from("reservations")
          .update({ deposit_paid_at: new Date().toISOString() })
          .eq("id", Number(reservation_id))
          .is("deposit_paid_at", null);
      }
    } catch (err) {
      console.error("Stripe webhook processing error:", err);
      // Non-2xx makes Stripe retry delivery — appropriate here since this is
      // likely a transient DB error, not a bad event.
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
