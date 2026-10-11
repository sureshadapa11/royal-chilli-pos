import { randomBytes } from "crypto";
import supabase from "@/lib/supabase";
import { bizDb } from "@/lib/business-db";
import { customerBusinessId, getActiveTiers, tierForSpend } from "@/lib/crm";
import { londonDateStr, londonWallTimeUtc, TRADING_DAY_START_HOUR, tradingDayStr } from "@/lib/london-date";
import { getBusinessNumber, getBusinessSetting } from "@/lib/business-settings";

// Each business's own rewards rules (Settings → Rewards rules, saved per
// business in business_settings).
export async function getLoyaltySetting(businessId: number, key: string, fallback: number): Promise<number> {
  return getBusinessNumber(businessId, key, fallback);
}

// Ledger reasons that are "points this order earned" — the base earn, the
// (now-retired) tier bonus, and the Tue–Thu doubling. Used wherever an
// order's earned points are read back or reversed, so none gets missed.
export const ORDER_EARN_REASONS = ["earned_purchase", "tier_bonus", "midweek_bonus"];

// ---------- double-points days ----------

const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday (1 = Mon … 7 = Sun) of a "YYYY-MM-DD" date. */
export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

async function getDoublePointsDays(businessId: number): Promise<number[]> {
  const value = await getBusinessSetting(businessId, "loyalty_double_points_days");
  return Array.isArray(value) ? (value as unknown[]).map(Number).filter((n) => n >= 1 && n <= 7) : [];
}

/**
 * Members earn 2× on quiet days (Tue–Thu by default). Judged on the trading
 * day (5am–5am UK), so Wednesday night's 00:30 bill still counts as
 * Wednesday. Returns the day's name when it's a double-points day, else null.
 */
export async function doublePointsDay(businessId: number, at: Date = new Date()): Promise<string | null> {
  const days = await getDoublePointsDays(businessId);
  const wd = isoWeekday(tradingDayStr(at));
  return days.includes(wd) ? WEEKDAY_NAMES[wd] : null;
}

// Shared by every code path that awards earning-type points (purchase,
// tier bonus, referral, birthday) so they're all swept by the same expiry
// cron consistently — a reason listed in EXPIRABLE_REASONS but never given
// an expires_at here would simply never expire, silently.
export async function getPointsExpiryTimestamp(businessId: number): Promise<string | null> {
  const months = await getLoyaltySetting(businessId, "loyalty_points_expiry_months", 12);
  if (!months || months <= 0) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// Direct points-to-money redemption — the everyday "use my points" button
// on the payment screen, separate from the reward catalogue. Only ever
// offered in fixed £-cap chunks: a balance worth less than the cap earns
// no partial credit (keeps accumulating toward the next full chunk), and a
// balance worth more than the cap still only redeems one chunk per
// transaction (the rest stays banked for next time).
//
// Rewards Club: £ steps (loyalty_redeem_step, £5) up to the per-visit cap
// (loyalty_max_redeem_per_visit, £10) — `options` lists what can be used
// right now (e.g. [5, 10]); `redeemAmount` is the largest of them.
export type CashCreditInfo = {
  rate: number;
  cap: number;
  step: number;
  convertedValue: number;
  eligible: boolean;
  options: number[];
  redeemAmount: number;
  redeemPoints: number;
};

export async function getCashCreditInfo(businessId: number, loyaltyPoints: number): Promise<CashCreditInfo> {
  const rate = await getLoyaltySetting(businessId, "loyalty_conversion_points_per_pound", 100);
  const cap = await getLoyaltySetting(businessId, "loyalty_max_redeem_per_visit", 5);
  const rawStep = await getLoyaltySetting(businessId, "loyalty_redeem_step", cap);
  const step = rawStep > 0 && rawStep <= cap ? rawStep : cap;
  const convertedValue = Math.floor((loyaltyPoints / rate) * 100) / 100;
  const options: number[] = [];
  for (let amt = step; amt <= cap + 1e-9 && amt <= convertedValue + 1e-9; amt += step) options.push(Math.round(amt * 100) / 100);
  const redeemAmount = options.length ? options[options.length - 1] : 0;
  return {
    rate,
    cap,
    step,
    convertedValue,
    eligible: options.length > 0,
    options,
    redeemAmount,
    redeemPoints: Math.round(redeemAmount * rate),
  };
}

// Unambiguous alphabet — no 0/O, 1/I/L — so a code read aloud or handwritten
// isn't misheard/miscopied. Not sequential/guessable (doc §23): drawn from
// crypto.randomBytes, not Math.random().
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRedemptionCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

export async function generateUniqueRedemptionCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRedemptionCode();
    const { data } = await supabase.from("loyalty_redemptions").select("id").eq("code", code).maybeSingle();
    if (!data) return code;
  }
  throw new Error("Could not generate a unique redemption code");
}

export type IssueRedemptionResult =
  | { ok: true; redemption: Record<string, unknown> & { id: number; code: string }; rewardName: string }
  | { ok: false; error: string };

// Shared by the staff-facing "issue a reward" endpoint and the birthday
// cron — same validation, same code/expiry generation, same audit trail,
// whichever triggers it. `staffId` is null for an automatic (cron) issue.
export async function issueRedemption(
  customerId: number,
  rewardId: number,
  staffId: number | null,
  opts: { validFrom?: Date } = {},
): Promise<IssueRedemptionResult> {
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, loyalty_points, business_id")
    .eq("id", customerId)
    .single();
  if (custErr || !customer) return { ok: false, error: "Customer not found" };

  // Only a reward from the customer's own business's scheme.
  const { data: reward, error: rewardErr } = await bizDb(customer.business_id)
    .from("loyalty_rewards")
    .select("*")
    .eq("id", rewardId)
    .maybeSingle();
  if (rewardErr || !reward) return { ok: false, error: "Reward not found" };
  if (!reward.active) return { ok: false, error: "This reward is no longer available" };

  const todayStr = londonDateStr();
  if (reward.start_date && todayStr < reward.start_date) return { ok: false, error: "This reward isn't available yet" };
  if (reward.end_date && todayStr > reward.end_date) return { ok: false, error: "This reward has ended" };

  if (customer.loyalty_points < reward.points_cost) {
    return { ok: false, error: `Not enough points — needs ${reward.points_cost}, has ${customer.loyalty_points}` };
  }

  if (reward.eligible_tier_id) {
    const { data: paidOrders } = await supabase.from("orders").select("total").eq("customer_id", customerId).eq("is_paid", true);
    const lifetimeSpend = (paidOrders || []).reduce((s, o) => s + Number(o.total), 0);
    const tiers = await getActiveTiers(customer.business_id);
    const customerTier = tierForSpend(tiers, lifetimeSpend);
    const requiredTier = tiers.find((t) => t.id === reward.eligible_tier_id);
    const customerRank = tiers.findIndex((t) => t.id === customerTier?.id);
    const requiredRank = tiers.findIndex((t) => t.id === requiredTier?.id);
    if (requiredTier && customerRank < requiredRank) {
      return { ok: false, error: `This reward requires ${requiredTier.name} tier or above` };
    }
  }

  if (reward.per_customer_limit != null) {
    const { count } = await supabase
      .from("loyalty_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("reward_id", rewardId)
      .in("status", ["issued", "redeemed"]);
    if ((count ?? 0) >= reward.per_customer_limit) {
      return { ok: false, error: "This customer has already used this reward the maximum number of times" };
    }
  }

  const code = await generateUniqueRedemptionCode();
  const expiresAt = new Date(Date.now() + Number(reward.valid_days || 7) * 24 * 60 * 60 * 1000);

  const { data: redemption, error: redemptionErr } = await supabase
    .from("loyalty_redemptions")
    .insert({
      code,
      customer_id: customerId,
      reward_id: rewardId,
      points_spent: reward.points_cost,
      status: "issued",
      issued_by_staff_id: staffId,
      expires_at: expiresAt.toISOString(),
      valid_from: opts.validFrom?.toISOString() ?? null,
    })
    .select()
    .single();
  if (redemptionErr) return { ok: false, error: "Failed to issue redemption" };

  if (reward.points_cost > 0) {
    const { error: ledgerErr } = await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      points_delta: -reward.points_cost,
      reason: "redeemed_reward",
      reference_type: "redemption",
      reference_id: redemption.id,
      staff_id: staffId,
    });
    if (ledgerErr) {
      // Compensate — don't leave an issued redemption whose points were never debited.
      await supabase.from("loyalty_redemptions").delete().eq("id", redemption.id);
      return { ok: false, error: "Failed to issue redemption" };
    }
  }

  return { ok: true, redemption, rewardName: reward.name };
}

// ---------- reward discounts at the till ----------

export type RewardTerms = {
  discount_amount: number | string | null;
  discount_pct: number | string | null;
  max_discount: number | string | null;
  order_types: string[] | null;
};

// £ off a bill for this reward: a percentage of the subtotal (capped at
// max_discount if set), else a fixed amount; never more than the subtotal.
// 0 = no money off (e.g. "free soft drink" — staff hand the item over).
export function rewardDiscount(reward: RewardTerms, subtotal: number): number {
  let off = 0;
  if (reward.discount_pct != null && Number(reward.discount_pct) > 0) {
    off = Math.round(subtotal * Number(reward.discount_pct)) / 100;
    if (reward.max_discount != null) off = Math.min(off, Number(reward.max_discount));
  } else if (reward.discount_amount != null) {
    off = Number(reward.discount_amount);
  }
  return Math.max(0, Math.min(Math.round(off * 100) / 100, subtotal));
}

export function rewardAllowsOrderType(reward: RewardTerms, orderType: string): boolean {
  return !reward.order_types || reward.order_types.length === 0 || reward.order_types.includes(orderType);
}

const ORDER_TYPE_LABEL: Record<string, string> = { dine_in: "dine-in", takeaway: "collection", delivery: "delivery" };
export const orderTypesLabel = (types: string[]) => types.map((t) => ORDER_TYPE_LABEL[t] ?? t).join(" / ");

/**
 * Rewards that are only ever given automatically — the welcome voucher on
 * joining, the Bring a Friend £5 and the come-back offers — can't be issued by hand, by staff or
 * by the customer; they cost 0 points, so a button for them would hand out
 * free vouchers. Returns an error message for those, else null.
 */
export async function manualIssueBlocked(rewardId: number): Promise<string | null> {
  const { data } = await supabase.from("loyalty_rewards").select("is_welcome_reward, is_referral_reward, winback_reason, is_birthday_reward, is_apology_reward").eq("id", rewardId).maybeSingle();
  if (data?.is_welcome_reward) return "The welcome voucher is given automatically when someone joins";
  if (data?.winback_reason) return "Come-back offers are only given by the \"why did you stop coming?\" email";
  if (data?.is_birthday_reward) return "The birthday treat is given automatically a week before a member's birthday";
  if (data?.is_apology_reward) return "Apology offers are sent from Customers → Feedback";
  if (data?.is_referral_reward) return "Bring a Friend vouchers are given automatically when a friend joins with a member's link";
  return null;
}

// ---------- Bring a Friend ----------

/** A member's shareable code, e.g. "RC7KX2QM" — unambiguous characters only. */
export async function generateReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `RC${generateRedemptionCode(6)}`;
    const { data } = await supabase.from("customers").select("id").eq("referral_code", code).maybeSingle();
    if (!data) return code;
  }
  throw new Error("Could not generate a unique referral code");
}

/** This business's member whose referral code this is (codes are matched case-insensitively). */
export async function findReferrer(businessId: number, code: string | null | undefined): Promise<number | null> {
  const clean = String(code ?? "").trim().toUpperCase();
  if (!clean) return null;
  const { data } = await bizDb(businessId).from("customers").select("id").eq("referral_code", clean).maybeSingle();
  return data?.id ?? null;
}

/**
 * A friend just signed up with `referrerId`'s link: give the referrer a £5
 * dine-in voucher, LOCKED until the friend's first paid visit (see
 * unlockReferralVoucher). Capped at loyalty_referral_max_per_year. Never
 * fails the friend's sign-up.
 */
export async function issueReferralVoucher(referrerId: number, friendId: number): Promise<void> {
  try {
    if (referrerId === friendId) return;
    const { data: referrer } = await supabase.from("customers").select("business_id").eq("id", referrerId).maybeSingle();
    if (!referrer) return;
    const { data: reward } = await bizDb(referrer.business_id)
      .from("loyalty_rewards")
      .select("id")
      .eq("is_referral_reward", true)
      .eq("active", 1)
      .limit(1)
      .maybeSingle();
    if (!reward) return;

    const maxPerYear = await getLoyaltySetting(referrer.business_id, "loyalty_referral_max_per_year", 10);
    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const { count } = await supabase
      .from("loyalty_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", referrerId)
      .eq("reward_id", reward.id)
      .gte("issued_at", yearAgo)
      .neq("status", "cancelled");
    if ((count ?? 0) >= maxPerYear) return;

    // Locked vouchers need an expiry for the NOT NULL column; the real 30
    // days start at unlock. A friend who never visits within a year → gone.
    await supabase.from("loyalty_redemptions").insert({
      code: await generateUniqueRedemptionCode(),
      customer_id: referrerId,
      reward_id: reward.id,
      points_spent: 0,
      status: "locked",
      referred_customer_id: friendId,
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    });
  } catch (err) {
    console.error(`Referral voucher not issued (referrer ${referrerId}, friend ${friendId}):`, err);
  }
}

/**
 * The friend's first qualifying visit: unlock the referrer's £5 voucher —
 * usable from now, for the reward's valid_days (30). Returns the referrer's
 * id when a voucher was unlocked, else null.
 */
export async function unlockReferralVoucher(friendId: number): Promise<number | null> {
  const { data: locked } = await supabase
    .from("loyalty_redemptions")
    .select("id, customer_id, reward:loyalty_rewards(valid_days)")
    .eq("referred_customer_id", friendId)
    .eq("status", "locked")
    .limit(1)
    .maybeSingle();
  if (!locked) return null;
  const days = Number((locked.reward as unknown as { valid_days?: number } | null)?.valid_days || 30);
  const { data: updated } = await supabase
    .from("loyalty_redemptions")
    .update({ status: "issued", issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + days * 24 * 3600 * 1000).toISOString() })
    .eq("id", locked.id)
    .eq("status", "locked")
    .select("id");
  return updated && updated.length > 0 ? locked.customer_id : null;
}

// ---------- welcome voucher ----------

/** Start of the next trading day (5am UK) — a voucher issued tonight can't be used on tonight's bill. */
export function nextTradingDayStart(at: Date = new Date()): Date {
  const [y, m, d] = tradingDayStr(at).split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return londonWallTimeUtc(next, TRADING_DAY_START_HOUR);
}

/**
 * A voucher not usable yet (valid_from in the future) — the message staff see
 * at the till, or null when it's fine to use now.
 */
export function notYetValidMessage(validFrom: string | null | undefined, now: Date = new Date()): string | null {
  if (!validFrom || new Date(validFrom) <= now) return null;
  const when = new Date(validFrom).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
  return `This voucher is for their next visit — it can be used from ${when}`;
}

/**
 * Why a reward code can't be used right now, or null if it can — the same
 * checks wherever a code is looked up (till and Staff Hub). Pure.
 */
// ---------- using rewards on a bill ----------

// Every reward (codes and "Use £x of points") needs the bill's food to come
// to at least this much before the reward (Settings → Rewards rules). A
// reward's own minimum, if higher, wins.
export const DEFAULT_REWARD_MIN_SPEND = 15;

export async function rewardMinSpend(businessId: number, rewardMin?: number | string | null): Promise<number> {
  const rule = await getLoyaltySetting(businessId, "loyalty_reward_min_spend", DEFAULT_REWARD_MIN_SPEND);
  return Math.max(rule, Number(rewardMin) || 0);
}

/** Refusal when `spend` (the bill before the reward) is under `minSpend`. */
export function minSpendProblem(minSpend: number, spend: number): { error: string; message: string } | null {
  if (minSpend <= 0 || spend >= minSpend - 0.005) return null;
  return {
    error: "MINIMUM_SPEND_NOT_MET",
    message: `Rewards need a spend of at least £${minSpend.toFixed(2)}: this bill is £${spend.toFixed(2)}`,
  };
}

/** One reward per bill: a £-off reward/points (its loyalty line) or a free-item code already used on it. */
export async function billRewardProblem(
  businessId: number,
  order: { id: number | string; loyalty_discount: number | string | null; loyalty_reason: string | null },
): Promise<string | null> {
  if (Number(order.loyalty_discount) > 0) return `This bill already has a loyalty reward (${order.loyalty_reason ?? "loyalty"})`;
  const { data } = await bizDb(businessId).from("loyalty_redemptions")
    .select("code, reward:loyalty_rewards(name)").eq("redeemed_order_id", Number(order.id)).limit(1);
  const used = data?.[0] as unknown as { code: string; reward: { name: string } | null } | undefined;
  return used ? `This bill already has a loyalty reward (${used.reward?.name ?? used.code})` : null;
}

export function redemptionProblem(
  r: { status: string; valid_from?: string | null; expires_at: string },
  now: Date = new Date(),
): { error: string; message: string } | null {
  if (r.status === "locked") return { error: "LOCKED", message: "This Bring a Friend voucher unlocks after their friend's first visit" };
  if (r.status === "redeemed") return { error: "ALREADY_REDEEMED", message: "This code has already been used" };
  if (r.status === "cancelled") return { error: "CANCELLED", message: "This code was cancelled" };
  const notYet = notYetValidMessage(r.valid_from, now);
  if (notYet) return { error: "NOT_YET_VALID", message: notYet };
  if (r.status === "expired" || new Date(r.expires_at) < now) return { error: "REWARD_EXPIRED", message: "This code has expired" };
  return null;
}

/**
 * Sign-up points (Rewards Club: 200). Once per customer — never a second
 * time, even if an old guest row is later claimed by signing up.
 */
export async function issueSignupPoints(customerId: number): Promise<boolean> {
  try {
    const businessId = await customerBusinessId(customerId);
    const points = await getLoyaltySetting(businessId, "loyalty_signup_points", 0);
    if (points <= 0) return false;
    const { data: already } = await supabase
      .from("loyalty_transactions")
      .select("id")
      .eq("customer_id", customerId)
      .eq("reason", "welcome_bonus")
      .limit(1);
    if (already && already.length > 0) return false;
    const { error } = await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      points_delta: points,
      reason: "welcome_bonus",
      reference_type: "signup",
      expires_at: await getPointsExpiryTimestamp(businessId),
    });
    return !error;
  } catch (err) {
    console.error(`Sign-up points not given to customer ${customerId}:`, err);
    return false;
  }
}

// A new account gets the welcome reward (migration 061: 20% off a dine-in
// bill, max £20, 30 days, once), usable from the next trading day — it's
// there to bring them back, not to discount the visit they joined on.
// Never fails the sign-up — no active welcome reward, or a hiccup, just
// means no voucher.
export async function issueWelcomeVoucher(customerId: number): Promise<void> {
  try {
    const { data: customer } = await supabase.from("customers").select("business_id").eq("id", customerId).maybeSingle();
    if (!customer) return;
    // The welcome voucher of the customer's own business's scheme.
    const { data: reward } = await bizDb(customer.business_id)
      .from("loyalty_rewards")
      .select("id")
      .eq("is_welcome_reward", true)
      .eq("active", 1)
      .limit(1)
      .maybeSingle();
    if (!reward) return;
    const result = await issueRedemption(customerId, reward.id, null, { validFrom: nextTradingDayStart() });
    if (!result.ok) console.error(`Welcome voucher not issued to customer ${customerId}: ${result.error}`);
  } catch (err) {
    console.error(`Welcome voucher not issued to customer ${customerId}:`, err);
  }
}
