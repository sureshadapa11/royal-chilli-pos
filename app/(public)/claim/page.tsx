import Link from "next/link";
import { getCustomerSession } from "@/lib/customer-auth";
import { claimableOrder, CLAIM_WINDOW_DAYS } from "@/lib/claim";
import { pageBusinessId } from "@/lib/business";
import { DEFAULT_REWARD_MIN_SPEND, getLoyaltySetting, rewardRuleText } from "@/lib/loyalty";
import ClaimButton from "./ClaimButton";

export const dynamic = "force-dynamic";

// Opened from the QR on a dine-in receipt: claim that bill's points.
export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ o?: string; k?: string }> }) {
  const { o = "", k = "" } = await searchParams;
  const check = await claimableOrder(Number(o), k);
  const session = await getCustomerSession();
  const back = encodeURIComponent(`/claim?o=${o}&k=${k}`);

  return (
    <div className="mx-auto max-w-sm px-6 py-14 text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Rewards Club</div>
      {!check.ok ? (
        <>
          <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl">Sorry</h1>
          <p className="mt-3 text-muted-foreground">{check.error}</p>
          <Link href="/account/loyalty" className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
            Go to my rewards
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl">Claim {check.order.points} points</h1>
          <p className="mt-2 text-muted-foreground">
            for your visit (bill {check.order.orderNumber}, £{check.order.total.toFixed(2)}).
          </p>
          {session ? (
            <ClaimButton o={o} k={k} name={session.name} />
          ) : (
            <div className="mt-6 space-y-3">
              <Link href={`/account/login?mode=signup&next=${back}`} className="block rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
                Join & claim — plus 200 bonus points
              </Link>
              <Link href={`/account/login?next=${back}`} className="block rounded-xl border border-border px-5 py-3 text-sm font-semibold">
                I already have an account
              </Link>
              <p className="text-xs text-muted-foreground">
                New members also get 20% off their next dine-in visit. Claim within {CLAIM_WINDOW_DAYS} days.
                <br />Rewards: {rewardRuleText(await getLoyaltySetting(await pageBusinessId(), "loyalty_reward_min_spend", DEFAULT_REWARD_MIN_SPEND)).toLowerCase()}.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
