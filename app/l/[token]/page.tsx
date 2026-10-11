import Link from "next/link";
import { getBusiness } from "@/lib/business";
import { businessForToken } from "@/lib/staff-links";
import LinkExpired from "@/components/links/LinkExpired";

// The staff link's start page: Day End or Cash In / Out.
export default async function StaffLinkHome({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const businessId = await businessForToken(token);
  if (!businessId) return <LinkExpired />;
  const name = (await getBusiness(businessId))?.name ?? "Staff";
  return (
    <div className="min-h-screen bg-[#fdf8ec] text-[#2b1a14]">
      <header className="bg-[#e4473a] px-5 pb-4 pt-5 text-white">
        <div className="font-[family-name:var(--font-playfair)] text-xl">{name}</div>
        <div className="text-sm opacity-85">Staff forms</div>
      </header>
      <main className="mx-auto max-w-md space-y-3 px-4 py-6">
        <Link href={`/l/${token}/day-end`} className="block rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="text-lg font-semibold">🌙 Day End</div>
          <div className="text-sm text-muted-foreground">Once a day, at closing: till, platforms, catering, cash counted</div>
        </Link>
        <Link href={`/l/${token}/cash`} className="block rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="text-lg font-semibold">💷 Cash In / Out</div>
          <div className="text-sm text-muted-foreground">Any time money goes in or out of the drawer</div>
        </Link>
      </main>
    </div>
  );
}
