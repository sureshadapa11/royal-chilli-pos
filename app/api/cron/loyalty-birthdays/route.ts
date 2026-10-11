import { NextRequest, NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { getBusinessNumber } from "@/lib/business-settings";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { issueRedemption, getPointsExpiryTimestamp } from "@/lib/loyalty";
import { birthdayLabel, birthdayTargetDate, isBirthdayOn } from "@/lib/birthday";
import { londonDateStr } from "@/lib/london-date";
import { sendBirthdayEmail } from "@/lib/email";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { SITE_URL } from "@/lib/site-url";

// Daily job: the birthday treat. A week before a member's birthday (UK date)
// they get every reward flagged is_birthday_reward (a free dessert, valid 14
// days so it covers the birthday fortnight) plus any birthday points, once a
// year, whichever run gets there first. Members who said yes to offers are
// emailed the code; everyone sees it in My account → Rewards.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = birthdayTargetDate(londonDateStr());
  const yearAgo = new Date(Date.now() - 300 * 86_400_000).toISOString(); // "this year" for a birthday a week away

  const { data: customers } = await supabase
    .from("customers")
    .select("id, business_id, name, email, marketing_consent, date_of_birth")
    .not("date_of_birth", "is", null)
    .is("merged_into", null); // a merged leftover isn't a customer of its own
  const birthdayCustomers = (customers || []).filter((c) => isBirthdayOn(c.date_of_birth as string, target));
  if (birthdayCustomers.length === 0) return NextResponse.json({ birthday: target, processed: 0, results: [] });

  // Each customer's own business's birthday points and birthday rewards.
  type Rules = { points: number; rewards: { id: number; name: string; description: string | null }[]; expiresAt: string | null };
  const rules = new Map<number, Rules>();
  const rulesFor = async (businessId: number): Promise<Rules> => {
    if (!rules.has(businessId)) {
      const { data: rewards } = await bizDb(businessId).from("loyalty_rewards").select("id, name, description").eq("is_birthday_reward", true).eq("active", 1);
      rules.set(businessId, {
        points: await getBusinessNumber(businessId, "loyalty_birthday_points", 0),
        rewards: (rewards ?? []) as Rules["rewards"],
        expiresAt: await getPointsExpiryTimestamp(businessId),
      });
    }
    return rules.get(businessId)!;
  };

  const results: { customer_id: number; name: string; points_awarded: number; rewards_issued: string[]; emailed: boolean; skipped: boolean }[] = [];
  for (const c of birthdayCustomers) {
    const { points: birthdayPoints, rewards: birthdayRewards, expiresAt } = await rulesFor(c.business_id);

    // Already looked after for this birthday? (points row or a birthday code)
    const [{ data: existingBonus }, { data: existingRedemption }] = await Promise.all([
      supabase.from("loyalty_transactions").select("id").eq("customer_id", c.id).eq("reason", "birthday_bonus").gte("created_at", yearAgo).limit(1),
      supabase.from("loyalty_redemptions").select("id").eq("customer_id", c.id).gte("issued_at", yearAgo).in("reward_id", birthdayRewards.map((r) => r.id).concat(-1)).limit(1),
    ]);
    if (existingBonus?.length || existingRedemption?.length) {
      results.push({ customer_id: c.id, name: c.name, points_awarded: 0, rewards_issued: [], emailed: false, skipped: true });
      continue;
    }

    if (birthdayPoints > 0) {
      await supabase.from("loyalty_transactions").insert({
        customer_id: c.id, points_delta: birthdayPoints, reason: "birthday_bonus",
        reference_type: "birthday", reference_id: c.id, expires_at: expiresAt,
      });
    }

    const issued: { code: string; expiresAt: string; name: string }[] = [];
    for (const reward of birthdayRewards) {
      const result = await issueRedemption(c.id, reward.id, null);
      if (result.ok) issued.push({ code: result.redemption.code, expiresAt: String(result.redemption.expires_at), name: reward.name });
    }

    // Awaited: on Vercel a send left running after the response may never happen.
    let emailed = false;
    if (issued.length && c.email && c.marketing_consent) {
      try {
        await sendBirthdayEmail(c.email, {
          businessId: c.business_id, customerName: c.name, birthday: birthdayLabel(c.date_of_birth as string) ?? "",
          offer: issued[0].name.replace(/^Birthday:\s*/i, ""), code: issued[0].code, expiresAt: issued[0].expiresAt,
          accountUrl: `${SITE_URL}/account/loyalty`, unsubscribeUrl: unsubscribeUrl(c.id),
        });
        emailed = true;
      } catch (err) {
        console.error(`Birthday email failed for customer ${c.id}:`, err);
      }
    }
    results.push({ customer_id: c.id, name: c.name, points_awarded: birthdayPoints, rewards_issued: issued.map((i) => i.code), emailed, skipped: false });
  }

  return NextResponse.json({ birthday: target, processed: results.length, results });
}
