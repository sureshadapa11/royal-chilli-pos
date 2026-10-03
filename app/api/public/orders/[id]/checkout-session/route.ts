import { NextRequest, NextResponse } from "next/server";
import { stripe, siteUrl } from "@/lib/stripe";
import { bizDb } from "@/lib/business-db";
import { getBusiness, onlineOrderingEnabled, websiteBusinessId } from "@/lib/business";

// Creates a Stripe Checkout Session for an already-created order (from
// POST /api/public/orders) so the customer can pay online instead of at
// collection/delivery. The order itself is unchanged either way — this just
// offers settling it before it's even sent to the kitchen.
//
// The metadata here (type + id) is what app/api/stripe/webhook reads back to
// know what to mark paid — the browser redirect to success_url is only a UX
// hint and is never trusted on its own.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!stripe) {
      return NextResponse.json({ error: "Online payment is not configured yet" }, { status: 503 });
    }

    const { id } = await params;
    const businessId = await websiteBusinessId(req.headers.get("host"));
    if (!(await onlineOrderingEnabled(businessId))) {
      return NextResponse.json({ error: "Online ordering is currently unavailable" }, { status: 503 });
    }
    const { data: order } = await bizDb(businessId).from("orders").select("*").eq("id", id).maybeSingle();
    // Only a website order placed as "Pay Online Now" can be paid here. This
    // route needs no login and order ids are sequential — without this check
    // anyone could start a checkout on a till or dine-in order, and a started
    // checkout keeps an unpaid order off the kitchen board.
    if (!order || !order.pay_online || order.staff_id) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (Number(order.amount_paid) >= Number(order.total)) {
      return NextResponse.json({ error: "This order is already paid" }, { status: 400 });
    }

    const remainingPence = Math.round((Number(order.total) - Number(order.amount_paid)) * 100);

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: remainingPence,
            product_data: { name: `${(await getBusiness(businessId))?.name ?? "The Royal Chilli"} — Order ${order.order_number}` },
          },
        },
      ],
      metadata: { type: "order", order_id: String(order.id) },
      success_url: `${siteUrl()}/order/confirmation?order_id=${order.id}`,
      cancel_url: `${siteUrl()}/order/checkout`,
      ...(order.customer_email ? { customer_email: order.customer_email } : {}),
    });

    await bizDb(businessId).from("orders").update({ stripe_session_id: checkout.id }).eq("id", id);

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Checkout session create error:", error);
    return NextResponse.json({ error: "Failed to start online payment" }, { status: 500 });
  }
}
