import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { findStaffByPin, isManagerRole } from "@/lib/staff-pin";
import { refundTransaction, sumupTransactionFromReference } from "@/lib/sumup";
import { ORDER_EARN_REASONS } from "@/lib/loyalty";
import { reverseVisitRewardsForFullRefund } from "@/lib/visits";
import { tillRequired } from "@/lib/till-device";

// A refund is just another row in `payments`, with a negative amount — same
// pattern as a normal payment, so the existing trigger that keeps
// orders.amount_paid in sync handles it for free. A paid order keeps its
// `paid` status (a financial correction, often long after the customer's
// left). The one status change: an order still in progress (open / in the
// kitchen / ready — typically a paid online order) that's now refunded in
// full is closed as cancelled, so it leaves the Kitchen Display and History
// stops offering "Take Payment" on it.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const notTill = await tillRequired(req, session.businessId);
    if (notTill) return notTill;

    const { id } = await params;
    const db = bizDb(session.businessId);
    const { amount, method, reason, manager_pin } = await req.json().catch(() => ({}));

    // Refunds move money back out, so only a manager can make one: either a
    // manager is signed in at the till, or one approves with their PIN — and
    // the refund is recorded against that manager.
    let approverId = session.id;
    if (!isManagerRole(session.role)) {
      // …a manager at this business (or the owner).
      const manager = manager_pin ? await findStaffByPin(String(manager_pin), session.businessId) : null;
      if (!manager || !isManagerRole(manager.role)) {
        return NextResponse.json(
          { error: "MANAGER_PIN_REQUIRED", message: manager_pin ? "That isn't a manager's PIN" : "A manager needs to approve refunds — enter a manager PIN" },
          { status: 403 }
        );
      }
      approverId = manager.id;
    }

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: "Refund amount is required" }, { status: 400 });
    }
    if (!method || !["cash", "card", "card_online"].includes(method)) {
      return NextResponse.json({ error: "A valid refund method is required" }, { status: 400 });
    }
    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: "A reason is required" }, { status: 400 });
    }

    const { data: order, error: fetchError } = await db
      .from("orders")
      .select("id, total, amount_paid, customer_id, status, table_id")
      .eq("id", id)
      .single();
    if (fetchError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const requestedAmount = Math.round(Number(amount) * 100) / 100;
    if (requestedAmount > Number(order.amount_paid) + 0.01) {
      return NextResponse.json(
        { error: `Cannot refund more than the £${Number(order.amount_paid).toFixed(2)} paid` },
        { status: 400 }
      );
    }

    // Card and online refunds move real money — never record anything in our
    // own ledger unless the provider (Stripe, or SumUp for the till's Solo
    // reader) actually confirms it, so "Refund" here can never say yes while
    // the customer's card still hasn't been credited.
    // Cash needs no such check: staff physically hand it back from the till.
    let refundAmount = requestedAmount;
    let providerRefundIds: string[] = [];
    let shortfall = 0;
    if (method === "card" || method === "card_online") {
      const result = await refundCard(session.businessId, Number(id), method, requestedAmount);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 502 });
      }
      refundAmount = result.refundedAmount;
      providerRefundIds = result.refundIds;
      shortfall = result.shortfall;
    }

    const { error: insertError } = await db.from("payments").insert({
      order_id: Number(id),
      method,
      amount: -refundAmount,
      staff_id: approverId,
      reference: providerRefundIds.length > 0 ? `Refund: ${String(reason).trim()} (${providerRefundIds.join(", ")})` : `Refund: ${String(reason).trim()}`,
    });
    if (insertError) throw insertError;

    if (order.customer_id) {
      await reverseLoyaltyPointsForRefund(session.businessId, Number(id), order.customer_id, refundAmount, Number(order.total));
      // Refunded in full: the visit didn't really happen — take back its visit
      // bonus and re-lock a Bring a Friend voucher it unlocked (if unused).
      const { data: refundRows } = await db.from("payments").select("amount").eq("order_id", id).lt("amount", 0);
      const refundedTotal = (refundRows ?? []).reduce((s, p) => s - Number(p.amount), 0);
      if (refundedTotal >= Number(order.total) - 0.01) {
        await reverseVisitRewardsForFullRefund(session.businessId, Number(id), order.customer_id);
      }
    }

    const { data: refreshed } = await db.from("orders").select("total, amount_paid").eq("id", id).single();

    const inProgress = ["open", "sent_to_kitchen", "ready"].includes(String(order.status));
    const fullyRefunded = refreshed != null && Number(refreshed.amount_paid) <= 0.009;
    if (inProgress && fullyRefunded) {
      await db.from("orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id);
      if (order.table_id) {
        await db.from("restaurant_tables").update({ status: "available", self_order_enabled: false }).eq("id", order.table_id);
      }
    }

    return NextResponse.json({
      success: true,
      amount_paid: refreshed?.amount_paid ?? null,
      refunded_amount: refundAmount,
      warning:
        shortfall > 0
          ? `Refunded £${refundAmount.toFixed(2)} to the card. £${shortfall.toFixed(2)} of the requested amount couldn't be matched to a card-reader or online payment (e.g. it was taken on a separate card machine) — refund that portion manually and record it here separately.`
          : undefined,
    });
  } catch (error) {
    console.error("Refund error:", error);
    return NextResponse.json({ error: "Failed to process refund" }, { status: 500 });
  }
}

// Actually moves the money back, against the real Stripe payment(s) behind
// this order — using the PaymentIntent id already stored on `payments`
// (directly, for a Terminal card-present payment; via the Checkout Session
// id, for an online payment). Spreads the requested amount across however
// many same-method payments exist on the order (almost always exactly one),
// oldest first, stopping the moment a refund attempt fails so a bad payment
// never blocks the ones before it. Any amount left over after that is
// reported back as a shortfall rather than silently dropped or over-claimed.
// Refunds across the order's original card payments, oldest first. Each
// payment's reference says where it was taken: "sumup:<id>" = the till's SumUp
// Solo, otherwise a Stripe PaymentIntent (till Stripe reader) or Checkout
// Session (online). Returned refund ids are labelled "Stripe re_…" /
// "SumUp <id>" for the refund row's reference.
async function refundCard(
  businessId: number,
  orderId: number,
  method: "card" | "card_online",
  amount: number
): Promise<{ ok: true; refundedAmount: number; refundIds: string[]; shortfall: number } | { ok: false; error: string }> {

  const { data: originals } = await bizDb(businessId)
    .from("payments")
    .select("amount, reference")
    .eq("order_id", orderId)
    .eq("method", method)
    .gt("amount", 0)
    .order("created_at", { ascending: true });

  if (!originals || originals.length === 0) {
    return { ok: false, error: `No ${method === "card" ? "card" : "online card"} payment was found on this order to refund against.` };
  }

  let remainingPence = Math.round(amount * 100);
  let refundedPence = 0;
  const refundIds: string[] = [];

  for (const p of originals) {
    if (remainingPence <= 0) break;
    if (!p.reference) continue;

    const sumupTxn = sumupTransactionFromReference(p.reference);
    if (sumupTxn) {
      const portion = Math.min(remainingPence, Math.round(Number(p.amount) * 100));
      try {
        await refundTransaction(sumupTxn, portion / 100);
        refundIds.push(`SumUp ${sumupTxn}`);
        refundedPence += portion;
        remainingPence -= portion;
      } catch (err) {
        console.error("SumUp refund failed for transaction", sumupTxn, err);
        break;
      }
      continue;
    }

    if (!stripe) continue;
    let paymentIntentId = p.reference;
    if (method === "card_online") {
      try {
        const checkoutSession = await stripe.checkout.sessions.retrieve(p.reference);
        if (!checkoutSession.payment_intent) continue;
        paymentIntentId = typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : checkoutSession.payment_intent.id;
      } catch {
        continue;
      }
    }

    const portion = Math.min(remainingPence, Math.round(Number(p.amount) * 100));
    try {
      const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, amount: portion });
      refundIds.push(`Stripe ${refund.id}`);
      refundedPence += portion;
      remainingPence -= portion;
    } catch (err) {
      console.error("Stripe refund failed for payment_intent", paymentIntentId, err);
      break;
    }
  }

  if (refundedPence === 0) {
    return { ok: false, error: "The refund didn't go through — the card payment may already be fully refunded, was taken on a separate card machine, or the payment provider refused it. Check the SumUp / Stripe dashboard directly." };
  }

  return { ok: true, refundedAmount: refundedPence / 100, refundIds, shortfall: remainingPence / 100 };
}

// Reverses the proportional share of points this order originally earned —
// a £10 refund on a £100 order reverses 10% of the points that order's
// earning rows (ORDER_EARN_REASONS) awarded. Tracks cumulative reversals
// against the order (via prior refund_reversal rows) so several partial
// refunds on the same order can never over-reverse it, and caps at the
// customer's current balance so it can never go negative. Never touches or
// deletes the original earning rows — this is a separate ledger entry.
async function reverseLoyaltyPointsForRefund(businessId: number, orderId: number, customerId: number, refundAmount: number, orderTotal: number) {
  if (orderTotal <= 0) return;

  const db = bizDb(businessId);
  const { data: earnRows } = await db
    .from("loyalty_transactions")
    .select("points_delta")
    .eq("reference_type", "order")
    .eq("reference_id", orderId)
    .in("reason", ORDER_EARN_REASONS);
  const originalEarned = (earnRows || []).reduce((s, r) => s + Number(r.points_delta), 0);
  if (originalEarned <= 0) return;

  const { data: priorReversals } = await db
    .from("loyalty_transactions")
    .select("points_delta")
    .eq("reference_type", "order")
    .eq("reference_id", orderId)
    .eq("reason", "refund_reversal");
  const alreadyReversed = Math.abs((priorReversals || []).reduce((s, r) => s + Number(r.points_delta), 0));
  const remainingReversible = Math.max(0, originalEarned - alreadyReversed);
  if (remainingReversible <= 0) return;

  const refundFraction = Math.min(1, refundAmount / orderTotal);
  let reversalAmount = Math.floor(originalEarned * refundFraction);
  reversalAmount = Math.min(reversalAmount, remainingReversible);

  const { data: customer } = await db.from("customers").select("loyalty_points").eq("id", customerId).single();
  reversalAmount = Math.min(reversalAmount, Math.max(0, Number(customer?.loyalty_points ?? 0)));
  if (reversalAmount <= 0) return;

  await db.from("loyalty_transactions").insert({
    customer_id: customerId,
    points_delta: -reversalAmount,
    reason: "refund_reversal",
    reference_type: "order",
    reference_id: orderId,
  });
}
