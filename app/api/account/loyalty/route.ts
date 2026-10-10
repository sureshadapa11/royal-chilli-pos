import { NextRequest, NextResponse } from "next/server";
import { customerBusinessId } from "@/lib/crm";
import { bizDb } from "@/lib/business-db";
import supabase from "@/lib/supabase";
import { getCustomerSessionFromRequest } from "@/lib/customer-auth";
import { getBusinessSetting } from "@/lib/business-settings";

// Everything the Loyalty tab needs in one call: current points, the active
// reward catalogue, this customer's active points voucher (if any), and their
// welcome voucher (from sign-up) if still unused — shown separately, since it
// isn't bought with points and doesn't count as "the" one active voucher. A
// voucher past its expires_at is lazily flipped to "expired" here rather than
// needing a cron, same pattern the redeem route already uses.
export async function GET(req: NextRequest) {
  const session = await getCustomerSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const businessId = await customerBusinessId(session.id);
  const [{ data: customer }, shareMessageSetting] = await Promise.all([
    supabase.from("customers").select("loyalty_points, referral_code").eq("id", session.id).maybeSingle(),
    getBusinessSetting(businessId, "loyalty_share_message"),
  ]);
  const shareSetting = { value: shareMessageSetting };

  const { data: rewards } = await bizDb(businessId)
    .from("loyalty_rewards")
    .select("id, name, description, points_cost, discount_amount")
    .eq("active", 1)
    .eq("is_welcome_reward", false)
    .eq("is_referral_reward", false)
    .is("winback_reason", null)
    .order("points_cost", { ascending: true });

  const { data: issued } = await supabase
    .from("loyalty_redemptions")
    .select("id, code, status, points_spent, issued_at, expires_at, valid_from, referred_customer_id, reward:loyalty_rewards(name, description, discount_amount, discount_pct, max_discount, order_types, is_welcome_reward, is_referral_reward, winback_reason)")
    .eq("customer_id", session.id)
    .in("status", ["issued", "locked"])
    .order("issued_at", { ascending: false });

  const now = new Date();
  const expired = (issued ?? []).filter((r) => new Date(r.expires_at) < now);
  for (const r of expired) await supabase.from("loyalty_redemptions").update({ status: "expired" }).eq("id", r.id);
  const live = (issued ?? []).filter((r) => new Date(r.expires_at) >= now);
  type Flags = { is_welcome_reward?: boolean; is_referral_reward?: boolean; winback_reason?: string | null } | null;
  const flags = (r: (typeof live)[number]) => (r.reward as unknown as Flags) ?? {};
  const isWelcome = (r: (typeof live)[number]) => !!flags(r).is_welcome_reward;
  const isReferral = (r: (typeof live)[number]) => !!flags(r).is_referral_reward;
  // Come-back offers ("why did you stop coming?") sit beside the points voucher, never instead of it.
  const isComeBack = (r: (typeof live)[number]) => !!flags(r).winback_reason;

  // Bring a Friend vouchers: a locked one hides its code (it can't be used
  // yet) and shows the friend's first name instead.
  const referral = live.filter(isReferral);
  const friendIds = [...new Set(referral.map((r) => r.referred_customer_id).filter(Boolean))] as number[];
  const { data: friends } = friendIds.length
    ? await supabase.from("customers").select("id, name").in("id", friendIds)
    : { data: [] as { id: number; name: string }[] };
  const friendName = new Map((friends ?? []).map((f) => [f.id, (f.name || "your friend").split(" ")[0]]));

  return NextResponse.json({
    points: customer?.loyalty_points ?? 0,
    rewards: rewards || [],
    activeRedemption: live.find((r) => !isWelcome(r) && !isReferral(r) && !isComeBack(r) && r.status === "issued") ?? null,
    comeBackVouchers: live.filter((r) => isComeBack(r) && r.status === "issued"),
    welcomeVoucher: live.find((r) => isWelcome(r) && r.status === "issued") ?? null,
    referralCode: customer?.referral_code ?? null,
    shareMessage: typeof shareSetting?.value === "string" ? shareSetting.value : null,
    referralVouchers: referral.map((r) => ({
      id: r.id,
      status: r.status,
      code: r.status === "locked" ? null : r.code,
      expires_at: r.status === "locked" ? null : r.expires_at,
      friend: friendName.get(r.referred_customer_id as number) ?? "your friend",
    })),
  });
}
