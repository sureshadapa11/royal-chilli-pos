import supabase from "@/lib/supabase";
import { tradingDayStr } from "@/lib/london-date";
import { getLoyaltySetting, getPointsExpiryTimestamp } from "@/lib/loyalty";
import { getBusinessSetting } from "@/lib/business-settings";
import { customerBusinessId } from "@/lib/crm";
import { bizDb } from "@/lib/business-db";

// Rewards Club visit bonuses. A visit = a trading day (5am–5am UK) on which
// the member had a paid, points-earning order; two bills on the same night
// are one visit. The bonus lands on the first bill of that day.

export type VisitBonusRules = { fixed: Record<number, number>; everyN: number; everyPoints: number };

export async function getVisitBonusRules(businessId: number): Promise<VisitBonusRules> {
  const data = { value: await getBusinessSetting(businessId, "loyalty_visit_bonus_fixed") };
  const raw = (data?.value ?? {}) as Record<string, unknown>;
  const fixed: Record<number, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(k);
    const pts = Number(v);
    if (Number.isInteger(n) && n > 1 && pts > 0) fixed[n] = Math.round(pts);
  }
  return {
    fixed,
    everyN: Math.max(0, Math.round(await getLoyaltySetting(businessId, "loyalty_visit_bonus_every_n", 0))),
    everyPoints: Math.max(0, Math.round(await getLoyaltySetting(businessId, "loyalty_visit_bonus_every_points", 0))),
  };
}

/** Bonus points for someone's `visit`th visit (1 = first visit: none by default). */
export function visitBonusFor(visit: number, rules: VisitBonusRules): number {
  if (rules.fixed[visit]) return rules.fixed[visit];
  if (rules.everyN > 1 && rules.everyPoints > 0 && visit % rules.everyN === 0) return rules.everyPoints;
  return 0;
}

/**
 * Which visit an order is: 0 if another points-earning order already started
 * that trading day (same visit), else the count of distinct trading days up
 * to and including this one. `orders` = the member's points-earning orders
 * (including this one), with their created_at.
 */
export function visitNumber(orderId: number, orders: { id: number; created_at: string }[]): number {
  const me = orders.find((o) => o.id === orderId);
  if (!me) return 0;
  const myDay = tradingDayStr(new Date(me.created_at));
  const earlierSameDay = orders.some(
    (o) => o.id !== orderId && tradingDayStr(new Date(o.created_at)) === myDay && o.created_at <= me.created_at,
  );
  if (earlierSameDay) return 0;
  const days = new Set(orders.map((o) => tradingDayStr(new Date(o.created_at))).filter((d) => d <= myDay));
  return days.size;
}

/**
 * For the payment screen: if the bill being paid now starts a new visit, which
 * visit it is and the bonus it'll bring. (Nothing if they've already had a
 * paid bill this trading day.)
 */
export async function upcomingVisitBonus(customerId: number, now: Date = new Date()): Promise<{ visit: number; points: number }> {
  const { data: earned } = await supabase
    .from("loyalty_transactions")
    .select("reference_id")
    .eq("customer_id", customerId)
    .eq("reason", "earned_purchase")
    .eq("reference_type", "order");
  const ids = [...new Set((earned ?? []).map((r) => Number(r.reference_id)))];
  const { data: orders } = ids.length
    ? await supabase.from("orders").select("id, created_at, status").in("id", ids)
    : { data: [] as { id: number; created_at: string; status: string }[] };
  const today = tradingDayStr(now);
  const days = new Set((orders ?? []).filter((o) => o.status !== "cancelled").map((o) => tradingDayStr(new Date(o.created_at))));
  if (days.has(today)) return { visit: 0, points: 0 };
  const visit = days.size + 1;
  return { visit, points: visit >= 2 ? visitBonusFor(visit, await getVisitBonusRules(await customerBusinessId(customerId))) : 0 };
}

/** Called once an order's purchase points are posted: add its visit bonus, if any. */
export async function awardVisitBonus(customerId: number, orderId: number): Promise<void> {
  try {
    const { data: already } = await supabase
      .from("loyalty_transactions")
      .select("id")
      .eq("customer_id", customerId)
      .eq("reason", "visit_bonus")
      .eq("reference_type", "order")
      .eq("reference_id", orderId)
      .limit(1);
    if (already && already.length) return;

    const { data: earned } = await supabase
      .from("loyalty_transactions")
      .select("reference_id")
      .eq("customer_id", customerId)
      .eq("reason", "earned_purchase")
      .eq("reference_type", "order");
    const ids = [...new Set((earned ?? []).map((r) => Number(r.reference_id)))];
    if (!ids.includes(orderId)) return;
    const { data: orders } = await supabase.from("orders").select("id, created_at, status").in("id", ids);
    const live = (orders ?? []).filter((o) => o.status !== "cancelled");

    const visit = visitNumber(orderId, live);
    if (visit < 2) return;
    const businessId = await customerBusinessId(customerId);
    const points = visitBonusFor(visit, await getVisitBonusRules(businessId));
    if (points <= 0) return;

    await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      points_delta: points,
      reason: "visit_bonus",
      reference_type: "order",
      reference_id: orderId,
      expires_at: await getPointsExpiryTimestamp(businessId),
    });
  } catch (err) {
    console.error(`Visit bonus failed (customer ${customerId}, order ${orderId}):`, err);
  }
}

/**
 * A bill has now been refunded in full: take back its visit bonus, and if it
 * was the friend's visit that unlocked a Bring a Friend voucher that hasn't
 * been used yet, lock that voucher again (the next real visit unlocks it).
 */
export async function reverseVisitRewardsForFullRefund(businessId: number, orderId: number, customerId: number): Promise<void> {
  const db = bizDb(businessId);
  // visit bonus — reversal row keyed by reference_type so the proportional
  // points reversal (which counts refund_reversal rows on 'order') ignores it
  const { data: bonus } = await db
    .from("loyalty_transactions")
    .select("points_delta")
    .eq("customer_id", customerId)
    .eq("reason", "visit_bonus")
    .eq("reference_type", "order")
    .eq("reference_id", orderId);
  const given = (bonus ?? []).reduce((s, r) => s + Number(r.points_delta), 0);
  const { data: reversed } = await db
    .from("loyalty_transactions")
    .select("id")
    .eq("reason", "refund_reversal")
    .eq("reference_type", "visit_bonus")
    .eq("reference_id", orderId)
    .limit(1);
  if (given > 0 && !(reversed && reversed.length)) {
    const { data: c } = await db.from("customers").select("loyalty_points").eq("id", customerId).single();
    const take = Math.min(given, Math.max(0, Number(c?.loyalty_points ?? 0)));
    if (take > 0) {
      await db.from("loyalty_transactions").insert({
        customer_id: customerId,
        points_delta: -take,
        reason: "refund_reversal",
        reference_type: "visit_bonus",
        reference_id: orderId,
      });
    }
  }

  // Bring a Friend: was this the friend's only qualifying visit?
  const { data: friend } = await db
    .from("customers")
    .select("referred_by_customer_id, referral_completed_at")
    .eq("id", customerId)
    .single();
  if (!friend?.referred_by_customer_id || !friend.referral_completed_at) return;
  const minSpend = await getLoyaltySetting(businessId, "loyalty_referral_min_spend", 20);
  const { data: others } = await db
    .from("orders")
    .select("id, total")
    .eq("customer_id", customerId)
    .eq("is_paid", true)
    .neq("id", orderId)
    .gte("total", minSpend);
  const otherIds = (others ?? []).map((o) => o.id);
  if (otherIds.length) {
    // a qualifying visit is one that wasn't itself refunded
    const { data: refunded } = await db.from("payments").select("order_id").in("order_id", otherIds).lt("amount", 0);
    const refundedIds = new Set((refunded ?? []).map((p) => p.order_id));
    if (otherIds.some((id) => !refundedIds.has(id))) return;
  }
  const { data: relocked } = await db
    .from("loyalty_redemptions")
    .update({ status: "locked", expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() })
    .eq("referred_customer_id", customerId)
    .eq("status", "issued")
    .select("id");
  if (relocked && relocked.length) {
    await db.from("customers").update({ referral_completed_at: null }).eq("id", customerId);
  }
}
