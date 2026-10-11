import { randomBytes } from "crypto";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { chunked } from "@/lib/finance";
import { issueRedemption } from "@/lib/loyalty";
import { sendComeBackOfferEmail, sendWinBackWhyEmail } from "@/lib/email";
import { unsubscribeUrl } from "@/lib/unsubscribe";
import { tradingDayStr } from "@/lib/london-date";
import { SITE_URL } from "@/lib/site-url";
import { ASK_AGAIN_AFTER_DAYS, WINBACK_REASONS, isWinBackReason, winBackDue, type WinBackReason } from "@/lib/winback-reasons";

// "Why did you stop coming?" Once a day, every customer who ticked "email me
// offers" and hasn't been in for 21 days gets one email (at most every 90
// days) with one-tap reasons. The reason they confirm on the website gives
// them that reason's come-back reward (loyalty_rewards.winback_reason) as a
// normal Rewards Club code for the till. A visit is a paid order or feedback
// left on "How was your meal?" (the till isn't always used).

export { WINBACK_REASONS, isWinBackReason, type WinBackReason };

const day = (iso: string) => tradingDayStr(new Date(iso));

/** The last visit (trading day) per customer, from paid orders and feedback in the last 180 days. */
async function lastVisits(customerIds: number[], since: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const keep = (id: number | null, iso: string) => {
    if (id == null) return;
    const d = day(iso);
    if (!out.has(id) || out.get(id)! < d) out.set(id, d);
  };
  const [orders, feedback] = await Promise.all([
    chunked(customerIds, async (ids) => (await supabase.from("orders").select("customer_id, created_at").eq("is_paid", true).in("customer_id", ids).gte("created_at", since)).data ?? []),
    chunked(customerIds, async (ids) => (await supabase.from("guest_feedback").select("customer_id, created_at").in("customer_id", ids).gte("created_at", since)).data ?? []),
  ]);
  for (const o of orders) keep(o.customer_id, o.created_at);
  for (const f of feedback) keep(f.customer_id, f.created_at);
  return out;
}

/** Daily: email everyone who's due. Returns how many were sent. */
export async function runWinBackEmails(now: Date = new Date()): Promise<{ winBack: number }> {
  const today = tradingDayStr(now);
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, email, business_id, winback_asked_at")
    .eq("marketing_consent", true)
    .not("email", "is", null)
    // A record merged into another (one customer, one record) is a leftover:
    // its visits and codes live on the record it was merged into.
    .is("merged_into", null);
  const list = (customers ?? []) as { id: number; name: string; email: string; business_id: number; winback_asked_at: string | null }[];
  if (!list.length) return { winBack: 0 };

  const since = new Date(now.getTime() - 200 * 86_400_000).toISOString();
  const visits = await lastVisits(list.map((c) => c.id), since);

  // Each business needs its come-back rewards set up to make the offer.
  const { data: rewards } = await supabase.from("loyalty_rewards").select("business_id, winback_reason").not("winback_reason", "is", null).eq("active", 1);
  const ready = new Set((rewards ?? []).map((r) => r.business_id));

  let sent = 0;
  for (const c of list) {
    const lastVisit = visits.get(c.id) ?? null;
    if (!ready.has(c.business_id) || !winBackDue(lastVisit, c.winback_asked_at ? day(c.winback_asked_at) : null, today)) continue;

    // Claim first, so a re-run never sends twice.
    const cutoff = new Date(now.getTime() - (ASK_AGAIN_AFTER_DAYS - 1) * 86_400_000).toISOString();
    const { data: claimed } = await supabase.from("customers").update({ winback_asked_at: now.toISOString() })
      .eq("id", c.id).or(`winback_asked_at.is.null,winback_asked_at.lt.${cutoff}`).select("id");
    if (!claimed?.length) continue;

    const token = randomBytes(18).toString("base64url");
    const { error } = await bizDb(c.business_id).from("winback_requests").insert({ customer_id: c.id, token, last_visit: lastVisit });
    if (error) { console.error(`Win-back request failed for customer ${c.id}:`, error.message); continue; }

    try {
      await sendWinBackWhyEmail(c.email, {
        businessId: c.business_id,
        customerName: c.name,
        reasons: WINBACK_REASONS.map((r) => ({ label: r.guest, url: `${SITE_URL}/come-back?t=${token}&r=${r.key}` })),
        unsubscribeUrl: unsubscribeUrl(c.id),
      });
      sent++;
    } catch (err) {
      console.error(`Win-back email failed for customer ${c.id}:`, err);
    }
  }
  return { winBack: sent };
}

export type WinBackOffer = { code: string; rewardName: string; description: string | null; expiresAt: string; reason: WinBackReason };

/** The request behind an email link, and the offer already given if it was answered. */
export async function findWinBack(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const { data: req } = await supabase.from("winback_requests")
    .select("id, business_id, customer_id, reason, answered_at, redemption_id, customers(name)")
    .eq("token", token).maybeSingle();
  if (!req) return null;
  let offer: WinBackOffer | null = null;
  if (req.redemption_id) {
    const { data: r } = await supabase.from("loyalty_redemptions")
      .select("code, expires_at, reward:loyalty_rewards(name, description)").eq("id", req.redemption_id).maybeSingle();
    const reward = r?.reward as unknown as { name: string; description: string | null } | null;
    if (r) offer = { code: r.code, rewardName: reward?.name ?? "Come-back offer", description: reward?.description ?? null, expiresAt: r.expires_at, reason: req.reason as WinBackReason };
  }
  const firstName = ((req.customers as unknown as { name: string } | null)?.name ?? "").split(" ")[0] || "there";
  return { id: req.id, businessId: req.business_id, customerId: req.customer_id, firstName, answered: !!req.answered_at, offer };
}

/** What each reason's offer is, for the confirm page. */
export async function winBackOffers(businessId: number): Promise<Partial<Record<WinBackReason, { name: string; description: string | null }>>> {
  const { data } = await bizDb(businessId).from("loyalty_rewards").select("name, description, winback_reason").not("winback_reason", "is", null).eq("active", 1);
  return Object.fromEntries((data ?? []).map((r) => [r.winback_reason, { name: r.name, description: r.description }]));
}

/** The customer confirmed a reason: give that reason's code (once per email). */
export async function answerWinBack(token: string, reason: WinBackReason, comment: string | null): Promise<{ ok: true; offer: WinBackOffer } | { ok: false; error: string }> {
  const req = await findWinBack(token);
  if (!req) return { ok: false, error: "This link isn't valid any more" };
  if (req.offer) return { ok: true, offer: req.offer };

  const { data: reward } = await bizDb(req.businessId).from("loyalty_rewards").select("id").eq("winback_reason", reason).eq("active", 1).maybeSingle();
  if (!reward) return { ok: false, error: "This offer isn't available right now. Please call us and we'll look after you." };

  // Claim the request before issuing, so two clicks can't make two codes.
  const { data: claimed } = await supabase.from("winback_requests")
    .update({ reason, comment, answered_at: new Date().toISOString() }).eq("id", req.id).is("answered_at", null).select("id");
  if (!claimed?.length) {
    const again = await findWinBack(token);
    return again?.offer ? { ok: true, offer: again.offer } : { ok: false, error: "Please try again in a moment" };
  }
  const issued = await issueRedemption(req.customerId, reward.id, null);
  if (!issued.ok) {
    await supabase.from("winback_requests").update({ answered_at: null, reason: null }).eq("id", req.id);
    return { ok: false, error: issued.error };
  }
  await supabase.from("winback_requests").update({ redemption_id: issued.redemption.id }).eq("id", req.id);
  const offer: WinBackOffer = { code: issued.redemption.code, rewardName: issued.rewardName, description: null, expiresAt: String(issued.redemption.expires_at), reason };

  // Their code by email too, so it's in their inbox (and in their account under Rewards).
  // Awaited: on Vercel a send left running after the response may never happen.
  try {
    const [{ data: customer }, { data: rw }] = await Promise.all([
      supabase.from("customers").select("name, email").eq("id", req.customerId).maybeSingle(),
      supabase.from("loyalty_rewards").select("description").eq("id", reward.id).maybeSingle(),
    ]);
    offer.description = rw?.description ?? null;
    if (customer?.email) {
      await sendComeBackOfferEmail(customer.email, {
        businessId: req.businessId, customerName: customer.name, offer: offer.rewardName.replace(/^Come-back:\s*/i, ""),
        description: offer.description, code: offer.code, expiresAt: offer.expiresAt, accountUrl: `${SITE_URL}/account/loyalty`,
      });
    }
  } catch (err) {
    console.error(`Come-back offer email failed (request ${req.id}):`, err);
  }
  return { ok: true, offer };
}

export type WinBackStats = {
  sent: number; answered: number;
  reasons: { key: WinBackReason; label: string; count: number }[];
  recent: { name: string; reason: string; comment: string | null; answeredAt: string; code: string | null; used: boolean }[];
};

/** Emails sent since `sinceIso`, answers and reasons (Staff Hub and Monday report). */
export async function winBackStats(businessId: number, sinceIso: string, untilIso?: string): Promise<WinBackStats> {
  let q = bizDb(businessId).from("winback_requests")
    .select("reason, comment, answered_at, sent_at, customers(name), redemption:loyalty_redemptions(code, status)")
    .gte("sent_at", sinceIso).order("sent_at", { ascending: false });
  if (untilIso) q = q.lte("sent_at", untilIso);
  const { data } = await q;
  const rows = (data ?? []) as unknown as { reason: WinBackReason | null; comment: string | null; answered_at: string | null; customers: { name: string } | null; redemption: { code: string; status: string } | null }[];
  const answered = rows.filter((r) => r.answered_at && r.reason);
  return {
    sent: rows.length,
    answered: answered.length,
    reasons: WINBACK_REASONS.map((r) => ({ key: r.key, label: r.short, count: answered.filter((a) => a.reason === r.key).length })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
    recent: answered.slice(0, 20).map((a) => ({
      name: a.customers?.name ?? "Customer",
      reason: WINBACK_REASONS.find((r) => r.key === a.reason)?.short ?? a.reason!,
      comment: a.comment, answeredAt: a.answered_at!, code: a.redemption?.code ?? null, used: a.redemption?.status === "redeemed",
    })),
  };
}

