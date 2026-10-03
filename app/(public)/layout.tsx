import { Jost } from "next/font/google";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import SplashScreen from "@/components/site/SplashScreen";
import CookieConsent from "@/components/site/CookieConsent";
import PromoBanner from "@/components/site/PromoBanner";
import { buildRestaurantSchema } from "@/lib/schema";
import { getOpeningHours, summarizeOpeningHours } from "@/lib/opening-hours";
import { bizDb } from "@/lib/business-db";
import type { Metadata } from "next";
import { getBusiness, pageBusinessId } from "@/lib/business";
import { SITE_URL } from "@/lib/site-url";
import { HoursProvider } from "@/components/site/HoursProvider";

// Every page under this layout reads staff-editable content (opening hours,
// hero text, promotions, etc.) straight from Supabase with no revalidate
// hint, so Next.js would otherwise statically cache it at build/deploy time —
// a manager's edit in Staff Hub wouldn't appear live until the next deploy.
// Forcing the whole route dynamic makes every save take effect immediately.
export const dynamic = "force-dynamic";

// This business's name for any page that doesn't set its own title (the root
// layout's defaults are neutral, shared by every business).
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBusiness(await pageBusinessId()).catch(() => null);
  if (!b) return {};
  return { title: b.name, description: `${b.name} — order online, book a table.` };
}

// Public-site-only body/nav font, styled after tamarindrestaurant.com's light,
// wide-tracked look. Their actual typeface (Domaine Sans) is a paid font
// licensed to them and hosted on their own domain, so this is the closest
// freely-licensed equivalent rather than a literal copy. Scoped to this
// layout only — POS, kitchen display, and staff hub keep the app's default
// font (Poppins, set in the root layout) for operational-screen legibility.
const jost = Jost({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-jost" });

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const siteUrl = SITE_URL;
  const openingHours = await getOpeningHours(await pageBusinessId());
  const schema = buildRestaurantSchema(siteUrl, openingHours);
  const hoursSummary = summarizeOpeningHours(openingHours);

  // This website's own business's banner.
  const { data: promo } = await bizDb(await pageBusinessId())
    .from("promotions")
    .select("title, description, link_url")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className={`${jost.variable} flex min-h-screen flex-col font-[family-name:var(--font-jost)]`}>
      {/* eslint-disable-next-line react/no-danger -- static JSON built server-side from siteContent, not user input */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <PromoBanner promo={promo} />
      <SplashScreen />
      <SiteHeader />
      {/* SiteHeader no longer renders a top bar — just the fixed hamburger
          button and its full-screen overlay — so there's no header height
          left to clear here. */}
      <main className="flex-1"><HoursProvider hours={openingHours}>{children}</HoursProvider></main>
      <SiteFooter hours={hoursSummary} />
      <CookieConsent />
    </div>
  );
}
