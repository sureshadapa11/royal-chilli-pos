import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";

// Cancels the customer's own not-yet-redeemed voucher and refunds the
// points via the ledger (trigger applies it to customers.loyalty_points —
// never write that column directly, same rule as everywhere else in the
// loyalty system).
export async function POST(req: NextRequest) {
  try {
    const session = await getCustomerSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // The active points voucher — never the welcome voucher, which isn't
    // bought with points and would just be lost.
    const { data: issued } = await supabase
      .from("loyalty_redemptions")
      .select("id, points_spent, customer_id, status, reward:loyalty_rewards(is_welcome_reward, is_referral_reward, winback_reason)")
      .eq("customer_id", session.id)
      .eq("status", "issued");
    // Only the points voucher: welcome, Bring a Friend and come-back codes are gifts, not cancellable.
    const redemption = (issued ?? []).find((r) => {
      const f = (r.reward as unknown as { is_welcome_reward?: boolean; is_referral_reward?: boolean; winback_reason?: string | null } | null) ?? {};
      return !f.is_welcome_reward && !f.is_referral_reward && !f.winback_reason;
    });
    if (!redemption) return NextResponse.json({ error: "No active voucher to cancel" }, { status: 404 });

    const { error: cancelErr } = await supabase.from("loyalty_redemptions").update({ status: "cancelled" }).eq("id", redemption.id);
    if (cancelErr) throw cancelErr;

    if (redemption.points_spent > 0) {
      await supabase.from("loyalty_transactions").insert({
        customer_id: session.id,
        points_delta: redemption.points_spent,
        reason: "redemption_cancelled",
        reference_type: "redemption",
        reference_id: redemption.id,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Cancel redemption error:", error);
    return NextResponse.json({ error: "Failed to cancel voucher" }, { status: 500 });
  }
}
