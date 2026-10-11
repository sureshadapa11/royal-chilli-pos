import type { Metadata } from "next";
import { pageBusinessId } from "@/lib/business";
import { bizDb } from "@/lib/business-db";
import Link from "next/link";
import supabase from "@/lib/supabase";
import { siteContent } from "@/lib/site-content";
import Reveal from "@/components/site/Reveal";
import { getBusinessSettings } from "@/lib/business-settings";

export const metadata: Metadata = {
  title: "Rewards Club Terms — The Royal Chilli",
  description: "How The Royal Chilli Rewards Club works: earning and using points, vouchers, Bring a Friend and emails.",
};

// Refreshed hourly: the numbers come from Staff Hub → Customers & Loyalty →
// Rewards Rules, so this page follows any change made there.
export const revalidate = 3600;

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function listDays(days: number[]): string {
  const names = [...days].sort().map((d) => DAY_NAMES[d]).filter(Boolean);
  if (names.length === 0) return "";
  // consecutive run → "Tuesday to Thursday"
  const consecutive = [...days].sort().every((d, i, a) => i === 0 || d === a[i - 1] + 1);
  if (consecutive && names.length > 2) return `From ${names[0]} to ${names[names.length - 1]}`;
  return `On ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}`;
}

async function rules() {
  const businessId = await pageBusinessId();
  const [all, { data: rewards }] = await Promise.all([
    getBusinessSettings(businessId),
    bizDb(businessId)
      .from("loyalty_rewards")
      .select("discount_pct, discount_amount, max_discount, valid_days, is_welcome_reward, is_referral_reward")
      .eq("active", 1)
      .or("is_welcome_reward.eq.true,is_referral_reward.eq.true"),
  ]);
  const s = new Map(Object.entries(all).filter(([k]) => k.startsWith("loyalty_")));
  const n = (k: string, d: number) => (Number.isFinite(Number(s.get(k))) ? Number(s.get(k)) : d);
  const welcome = (rewards ?? []).find((r) => r.is_welcome_reward);
  const referral = (rewards ?? []).find((r) => r.is_referral_reward);
  const fixed = (s.get("loyalty_visit_bonus_fixed") ?? {}) as Record<string, number>;
  return {
    perPound: n("loyalty_points_per_pound", 10),
    pointsPerPoundOff: n("loyalty_conversion_points_per_pound", 100),
    doubleDays: Array.isArray(s.get("loyalty_double_points_days")) ? (s.get("loyalty_double_points_days") as number[]) : [],
    maxPerVisit: n("loyalty_max_redeem_per_visit", 10),
    step: n("loyalty_redeem_step", 5),
    signup: n("loyalty_signup_points", 200),
    expiryMonths: n("loyalty_points_expiry_months", 12),
    visit2: Number(fixed["2"] ?? 0),
    visit3: Number(fixed["3"] ?? 0),
    everyN: n("loyalty_visit_bonus_every_n", 0),
    everyPoints: n("loyalty_visit_bonus_every_points", 0),
    referralMin: n("loyalty_referral_min_spend", 20),
    rewardMin: n("loyalty_reward_min_spend", 15),
    referralMax: n("loyalty_referral_max_per_year", 10),
    welcomePct: Number(welcome?.discount_pct ?? 20),
    welcomeMax: Number(welcome?.max_discount ?? 20),
    welcomeDays: Number(welcome?.valid_days ?? 30),
    referralAmount: Number(referral?.discount_amount ?? 5),
    referralDays: Number(referral?.valid_days ?? 30),
  };
}

export default async function RewardsTermsPage() {
  const r = await rules();
  const money = (v: number) => `£${v % 1 === 0 ? v : v.toFixed(2)}`;
  const double = listDays(r.doubleDays);
  const bonuses = [
    r.visit2 > 0 ? `${r.visit2} bonus points on your 2nd visit` : "",
    r.visit3 > 0 ? `${r.visit3} on your 3rd` : "",
    r.everyN > 1 && r.everyPoints > 0 ? `${r.everyPoints} on every ${r.everyN}th visit` : "",
  ].filter(Boolean);
  const bonusText = bonuses.length > 1 ? `${bonuses.slice(0, -1).join(", ")} and ${bonuses[bonuses.length - 1]}` : bonuses[0] ?? "";

  const sections: { heading: string; body: string[] }[] = [
    {
      heading: "About the Rewards Club",
      body: [
        `The Rewards Club is The Royal Chilli's free loyalty scheme, run by The Royal Chilli at ${siteContent.contact.address}. You join by creating an account on our website or by giving your details to our staff. By joining, you agree to these terms, which sit alongside our main Terms & Conditions and Privacy Policy.`,
        "Membership is free and open to anyone aged 16 or over. One account per person.",
      ],
    },
    {
      heading: "Earning points",
      body: [
        `You earn ${r.perPound} points for every £1 you spend on a paid bill, whether you dine in, collect or have your order delivered. Points are worked out on the amount you actually pay, after any discount, and are added once the bill is fully paid.${double ? ` ${double} you earn double points.` : ""} A "day" runs from 5am to 5am, so a meal just after midnight counts towards the evening before.`,
        `When you join you receive ${r.signup} welcome points.${bonuses.length ? ` You also earn ${bonusText}. A visit is a day on which you have a paid bill — two bills on the same day count as one visit.` : ""}`,
        "Dining in? Ask our staff to add your points to the bill, or scan the QR code on your receipt within 7 days to claim them yourself. Points can't be added to a bill that has already been linked to another member.",
      ],
    },
    {
      heading: "Using points",
      body: [
        `${r.pointsPerPoundOff} points are worth ${money(1)} off. Points can be used when you dine in, in steps of ${money(r.step)}, up to ${money(r.maxPerVisit)} per visit. They can't be used on collection or delivery orders.`,
        `Only one reward, voucher or points discount can be used per bill${r.rewardMin > 0 ? `, and only on a bill of at least ${money(r.rewardMin)} before the reward` : ""}.`,
        "Points and rewards have no cash value, can't be exchanged for cash, and can't be transferred to another person.",
        `Points expire ${r.expiryMonths} months after you earn them if they haven't been used.`,
      ],
    },
    {
      heading: "Welcome voucher",
      body: [
        `New members receive a voucher for ${r.welcomePct}% off a dine-in bill (up to ${money(r.welcomeMax)} off). It is for your next visit — it can be used from the day after you join — and is valid for ${r.welcomeDays} days. One welcome voucher per person.`,
      ],
    },
    {
      heading: "Bring a Friend",
      body: [
        `Share your personal link from your account. When a friend who hasn't been a member before joins through it, they receive the usual welcome points and voucher, and you receive a ${money(r.referralAmount)} dine-in voucher.`,
        `Your voucher shows as locked until your friend's first paid visit with a bill of at least ${money(r.referralMin)}. It then unlocks and is valid for ${r.referralDays} days. If that bill is refunded in full before you've used the voucher, it locks again until your friend's next qualifying visit.`,
        `You can earn up to ${r.referralMax} Bring a Friend vouchers a year. You can't refer yourself, and existing customers can't be referred.`,
      ],
    },
    {
      heading: "Refunds",
      body: [
        "If a bill is refunded, the points it earned (including any double points) are taken back in proportion to the refund. If it's refunded in full, any visit bonus it earned is taken back too.",
      ],
    },
    {
      heading: "Emails",
      body: [
        "We'll email you about your account — for example your welcome voucher, or when a Bring a Friend voucher unlocks.",
        "If you tick the box to hear about offers and rewards, we'll also send you occasional messages such as a thank-you after your first visit, a reminder if we haven't seen you for a while, and offers. Every one of these includes an Unsubscribe link, and you can change your choice in your account at any time.",
      ],
    },
    {
      heading: "Fair use",
      body: [
        "We may cancel points, vouchers or memberships that we reasonably believe have been obtained by fraud, misuse or breaking these terms — for example fake accounts created to collect Bring a Friend rewards.",
      ],
    },
    {
      heading: "Changes to the Rewards Club",
      body: [
        "We may change these terms, the rewards on offer, or how many points are earned or needed, and we may end the Rewards Club. We'll give you reasonable notice of any significant change, and points you've already earned will be honoured for a reasonable period after any change is announced.",
      ],
    },
    {
      heading: "Contact us",
      body: [`Email: Info@theroyalchilli.com`, `Phone: ${siteContent.contact.phone}`],
    },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Reveal>
        <p className="text-xs uppercase tracking-[0.3em] text-primary">Rewards Club</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl">Rewards Club Terms</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: 28 September 2026</p>
      </Reveal>

      <div className="mt-10 space-y-8">
        {sections.map((s, i) => (
          <Reveal key={s.heading} delay={i * 30}>
            <h2 className="font-[family-name:var(--font-playfair)] text-xl">{s.heading}</h2>
            <div className="mt-3 space-y-2">
              {s.body.map((p, j) => (
                <p key={j} className="text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
            </div>
          </Reveal>
        ))}
      </div>

      <p className="mt-12 text-sm text-muted-foreground">
        See also our <Link href="/terms" className="underline">Terms &amp; Conditions</Link> and{" "}
        <Link href="/privacy-policy" className="underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}
