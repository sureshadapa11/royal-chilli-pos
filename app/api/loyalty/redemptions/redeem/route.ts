import { NextRequest, NextResponse } from "next/server";
import { bizDb } from "@/lib/business-db";
import { getSessionFromRequest } from "@/lib/auth";
import { recalcTotals } from "@/lib/order-totals";
import { notYetValidMessage, orderTypesLabel, rewardAllowsOrderType, rewardDiscount, type RewardTerms } from "@/lib/loyalty";

// Applies an issued redemption to a specific order at the till — any staff
// member can (the "Loyalty Reward Code" box in the payment screen); codes
// are one-time and fully checked here. A reward with money off (a £ amount,
// or a % of the bill capped at max_discount — see rewardDiscount) sets the
// order's loyalty line (its own line — a staff discount on the same bill
// stays); a reward with no money off (e.g. "free soft
// drink") just gets marked redeemed — staff hand over the item. A reward
// limited to some order types (the welcome voucher: dine-in only) is refused
// on any other order.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { code, order_id } = await req.json();
    if (!code || !order_id) return NextResponse.json({ error: "code and order_id are required" }, { status: 400 });

    const db = bizDb(session.businessId);
    const { data: redemption, error: fetchErr } = await db
      .from("loyalty_redemptions")
      .select("*, reward:loyalty_rewards(name, discount_amount, discount_pct, max_discount, order_types, min_spend)")
      .eq("code", String(code).trim().toUpperCase())
      .maybeSingle();
    if (fetchErr || !redemption) return NextResponse.json({ error: "INVALID_CODE", message: "No reward found with that code" }, { status: 404 });

    if (redemption.status === "locked") {
      return NextResponse.json({ error: "LOCKED", message: "This Bring a Friend voucher unlocks after their friend's first visit" }, { status: 400 });
    }
    if (redemption.status === "redeemed") {
      return NextResponse.json({ error: "ALREADY_REDEEMED", message: "This code has already been used" }, { status: 400 });
    }
    if (redemption.status === "cancelled") {
      return NextResponse.json({ error: "CANCELLED", message: "This code was cancelled" }, { status: 400 });
    }
    const notYet = notYetValidMessage(redemption.valid_from);
    if (notYet) return NextResponse.json({ error: "NOT_YET_VALID", message: notYet }, { status: 400 });
    if (redemption.status === "expired" || new Date(redemption.expires_at) < new Date()) {
      if (redemption.status !== "expired") await db.from("loyalty_redemptions").update({ status: "expired" }).eq("id", redemption.id);
      return NextResponse.json({ error: "REWARD_EXPIRED", message: "This code has expired" }, { status: 400 });
    }

    // The till's own business's order only.
    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, status, is_paid, order_type, subtotal, total, loyalty_discount, loyalty_reason")
      .eq("id", order_id)
      .single();
    if (orderErr || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.is_paid || order.status === "cancelled") {
      return NextResponse.json({ error: "This order can no longer be changed" }, { status: 409 });
    }

    const reward = redemption.reward as RewardTerms & { name: string; min_spend: number };
    if (!rewardAllowsOrderType(reward, order.order_type)) {
      return NextResponse.json(
        { error: "WRONG_ORDER_TYPE", message: `This voucher is for ${orderTypesLabel(reward.order_types!)} orders only` },
        { status: 400 }
      );
    }
    if (reward.min_spend && Number(order.total) < Number(reward.min_spend)) {
      return NextResponse.json(
        { error: "MINIMUM_SPEND_NOT_MET", message: `This reward needs a spend of at least £${Number(reward.min_spend).toFixed(2)}` },
        { status: 400 }
      );
    }

    // A % reward is fixed to £ here (capped), from the bill as it stands now
    // — recalculated first so every item on it counts.
    const current = await recalcTotals(String(order_id), session.businessId);
    const discount = rewardDiscount(reward, current.subtotal);
    let updatedBill = null;
    if (discount > 0) {
      // One loyalty reward per bill (it has one loyalty line) — never swap one out unseen.
      if (Number(order.loyalty_discount) > 0) {
        return NextResponse.json({ error: `This bill already has a loyalty reward (${order.loyalty_reason ?? "loyalty"})` }, { status: 409 });
      }
      await db
        .from("orders")
        .update({
          loyalty_discount: discount,
          loyalty_reason: `Loyalty reward: ${reward.name}`,
          // Whoever is signed in on the till applied it.
          loyalty_given_by_staff_id: session.id,
          loyalty_given_by: session.name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order_id);
      updatedBill = await recalcTotals(String(order_id), session.businessId);
    }

    const { error: updateErr } = await db
      .from("loyalty_redemptions")
      .update({
        status: "redeemed",
        redeemed_at: new Date().toISOString(),
        redeemed_by_staff_id: session.id,
        redeemed_order_id: order_id,
      })
      .eq("id", redemption.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, reward_name: reward.name, discount_applied: discount, bill: updatedBill });
  } catch (error) {
    console.error("Redemption redeem error:", error);
    return NextResponse.json({ error: "Failed to redeem reward" }, { status: 500 });
  }
}
