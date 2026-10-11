import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { recalcTotals } from "@/lib/order-totals";
import { billFoodTotal, billRewardProblem, getCashCreditInfo, minSpendProblem, rewardMinSpend } from "@/lib/loyalty";

// One-tap "use my points" at the till — no code, no Staff Hub trip. Offered
// in £ steps up to the per-visit cap (see getCashCreditInfo: £5 or £10);
// body `amount` picks one, default the largest. Dine-in bills only. Any till
// user can apply it (their name is saved on the order). It goes on the
// order's loyalty line, same as a code redemption — a staff discount on the
// same bill stays.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { customer_id, order_id, amount, extra_order_ids } = await req.json();
    if (!customer_id || !order_id) return NextResponse.json({ error: "customer_id and order_id are required" }, { status: 400 });

    // The till's own business's order only.
    const db = bizDb(session.businessId);
    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, status, is_paid, order_type, table_id, loyalty_discount, loyalty_reason")
      .eq("id", order_id)
      .single();
    if (orderErr || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.is_paid || order.status === "cancelled") {
      return NextResponse.json({ error: "This order can no longer be changed" }, { status: 409 });
    }
    // One loyalty reward per bill (it has one loyalty line; a free-item code
    // counts too) — never swap one out unseen.
    const already = await billRewardProblem(session.businessId, order);
    if (already) return NextResponse.json({ error: already }, { status: 409 });
    if (order.order_type !== "dine_in") {
      return NextResponse.json({ error: "Points can only be used on dine-in bills" }, { status: 400 });
    }

    // Minimum spend, on the food before the reward.
    const current = await recalcTotals(String(order_id), session.businessId);
    const food = await billFoodTotal(session.businessId, order, Number(current.subtotal), extra_order_ids);
    const short = minSpendProblem(await rewardMinSpend(session.businessId), food);
    if (short) return NextResponse.json({ error: short.message }, { status: 400 });

    // Guard against double-tapping the button (or a retried request) — never
    // debit twice for the same order.
    const { data: existing } = await db
      .from("loyalty_transactions")
      .select("id")
      .eq("reference_type", "cash_credit")
      .eq("reference_id", order_id)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: "Loyalty credit has already been applied to this order" }, { status: 400 });
    }

    const { data: customer } = await bizDb(session.businessId).from("customers").select("loyalty_points").eq("id", customer_id).maybeSingle();
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const cashCredit = await getCashCreditInfo(session.businessId, customer.loyalty_points);
    if (!cashCredit.eligible) {
      return NextResponse.json(
        { error: `Not enough points yet — needs £${(cashCredit.step - cashCredit.convertedValue).toFixed(2)} more` },
        { status: 400 }
      );
    }
    const useAmount = amount == null ? cashCredit.redeemAmount : Number(amount);
    if (!cashCredit.options.includes(useAmount)) {
      return NextResponse.json({ error: `Can use ${cashCredit.options.map((o) => `£${o}`).join(" or ")} of points on this visit` }, { status: 400 });
    }
    const usePoints = Math.round(useAmount * cashCredit.rate);

    const { error: ledgerErr } = await db.from("loyalty_transactions").insert({
      customer_id,
      points_delta: -usePoints,
      reason: "redeemed_reward",
      reference_type: "cash_credit",
      reference_id: order_id,
      staff_id: session.id,
    });
    if (ledgerErr) throw ledgerErr;

    await db
      .from("orders")
      .update({
        loyalty_discount: useAmount,
        loyalty_reason: "Loyalty credit",
        loyalty_given_by_staff_id: session.id,
        loyalty_given_by: session.name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order_id);
    const bill = await recalcTotals(String(order_id), session.businessId);

    return NextResponse.json({ success: true, amount: useAmount, points_spent: usePoints, bill });
  } catch (error) {
    console.error("Cash-credit redeem error:", error);
    return NextResponse.json({ error: "Failed to apply loyalty credit" }, { status: 500 });
  }
}
