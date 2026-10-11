import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
import { issueRedemption, manualIssueBlocked } from "@/lib/loyalty";

// Self-service version of the same issueRedemption staff already use from
// Staff Hub — points are debited immediately (not held), same as any other
// staff-issued redemption; staffId is null to mark it as self-issued.
export async function POST(req: NextRequest) {
  try {
    const session = await getCustomerSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { reward_id } = await req.json();
    if (!reward_id) return NextResponse.json({ error: "reward_id is required" }, { status: 400 });

    // Only one active points voucher at a time — matches "one reward per
    // transaction". The welcome, Bring a Friend and come-back vouchers don't count.
    const { data: issued } = await supabase
      .from("loyalty_redemptions")
      .select("id, reward:loyalty_rewards(is_welcome_reward, is_referral_reward, winback_reason, is_birthday_reward, is_apology_reward)")
      .eq("customer_id", session.id)
      .eq("status", "issued");
    const existing = (issued ?? []).find((r) => {
      const f = (r.reward as unknown as { is_welcome_reward?: boolean; is_referral_reward?: boolean; winback_reason?: string | null; is_birthday_reward?: boolean; is_apology_reward?: boolean } | null) ?? {};
      return !f.is_welcome_reward && !f.is_referral_reward && !f.winback_reason && !f.is_birthday_reward && !f.is_apology_reward;
    });
    if (existing) {
      return NextResponse.json({ error: "You already have an active voucher — cancel it first to redeem a different reward" }, { status: 409 });
    }

    const blocked = await manualIssueBlocked(Number(reward_id));
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
    const result = await issueRedemption(session.id, Number(reward_id), null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({ success: true, redemption: result.redemption });
  } catch (error) {
    console.error("Self-issue redemption error:", error);
    return NextResponse.json({ error: "Failed to redeem reward" }, { status: 500 });
  }
}
