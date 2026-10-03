import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { stripe, siteUrl } from "@/lib/stripe";
import { startReaderCheckout } from "@/lib/sumup";
import { getTillReader } from "@/lib/till-reader";
import { tillRequired } from "@/lib/till-device";

// Pushes a real charge to the till's card reader — a SumUp Solo or a Stripe
// Terminal reader, whichever Settings selects. Returns as soon as the reader
// has been told to collect; the client polls /api/pos/terminal/status with
// the returned charge_id, since the customer still has to tap/insert.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const notTill = await tillRequired(req, session);
    if (notTill) return notTill;

    const { amount, order_number } = await req.json();
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      return NextResponse.json({ error: "A positive amount is required" }, { status: 400 });
    }

    const reader = await getTillReader(session.businessId);
    if (reader.provider === "none") {
      return NextResponse.json({ error: "No card reader is configured in Settings" }, { status: 400 });
    }

    if (reader.provider === "sumup") {
      const chargeId = await startReaderCheckout(
        reader.readerId,
        amountNum,
        `${siteUrl()}/api/sumup/webhook`,
        order_number ? `Royal Chilli ${order_number}` : undefined
      );
      return NextResponse.json({ charge_id: chargeId });
    }

    if (!stripe) {
      return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
    }
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amountNum * 100),
      currency: "gbp",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
    });
    await stripe.terminal.readers.processPaymentIntent(reader.readerId, { payment_intent: intent.id });
    return NextResponse.json({ charge_id: intent.id });
  } catch (error) {
    console.error("Terminal charge error:", error);
    const message = error instanceof Error ? error.message : "Failed to start card reader payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
