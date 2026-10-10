import type { Metadata } from "next";
import { findWinBack, winBackOffers } from "@/lib/winback";
import { isWinBackReason } from "@/lib/winback-reasons";
import ComeBack from "@/components/site/ComeBack";

// Opened from the "Why did you stop coming?" email. The reason in the link is
// only pre-selected: the customer confirms it here (email scanners open every
// link, so a link alone must never choose for them).
export const metadata: Metadata = { title: "We'd love to see you again", robots: { index: false } };

export default async function ComeBackPage({ searchParams }: { searchParams: Promise<{ t?: string; r?: string }> }) {
  const { t = "", r } = await searchParams;
  const req = await findWinBack(t);
  if (!req) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-[family-name:var(--font-playfair)] text-2xl">This link has expired</h1>
        <p className="mt-2 text-muted-foreground">Please call us on 020 8797 3044. We&apos;d still love to hear from you.</p>
      </div>
    );
  }
  return (
    <ComeBack token={t} firstName={req.firstName} initialReason={isWinBackReason(r) ? r : null}
      offers={await winBackOffers(req.businessId)} offer={req.offer} />
  );
}
