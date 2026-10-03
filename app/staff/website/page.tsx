import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { getBusiness } from "@/lib/business";
import WebsiteConfigView from "@/components/staff/WebsiteConfigView";
import WebsiteMenuPhotos from "@/components/staff/WebsiteMenuPhotos";
import { trafficSummary, type TrafficSummary } from "@/lib/website-traffic";

const heading = { fontFamily: "var(--font-space-grotesk)" };

// What this tab covers.
const ROADMAP = [
  { icon: "🛒", title: "Online ordering", text: "Switch website orders on or off, or show \"coming soon\"." },
  { icon: "🔎", title: "SEO", text: "Page titles, descriptions and social-sharing previews so customers find you on search." },
  { icon: "📊", title: "Website traffic", text: "Visits, popular pages and how many visits turn into orders — counted without cookies." },
  { icon: "📸", title: "Menu & photos", text: "Choose which dishes appear online and upload photos for your menu and gallery." },
];

const fmtDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function TrafficCard({ t }: { t: TrafficSummary | null }) {
  if (!t) {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t load the figures just now.</p>;
  }
  const rate = t.visits ? Math.round((t.orderingVisits / t.visits) * 1000) / 10 : 0;
  const max = Math.max(1, ...t.daily.map((d) => d.visits));
  const tiles = [
    { label: `Visits (last ${t.days} days)`, value: t.visits.toLocaleString("en-GB"), sub: `${t.pageViews.toLocaleString("en-GB")} ${t.pageViews === 1 ? "page" : "pages"} viewed` },
    { label: "Visits that order", value: t.orderingVisits.toLocaleString("en-GB"), sub: `${rate}% of visits` },
    { label: "Today", value: (t.daily[t.daily.length - 1]?.visits ?? 0).toLocaleString("en-GB"), sub: "visits so far" },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-lg border border-border p-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{x.label}</p>
            <p className="mt-1 text-[22px] font-semibold text-foreground">{x.value}</p>
            <p className="text-[12px] text-muted-foreground">{x.sub}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-20 items-end gap-[3px]" aria-label="Visits per day">
        {t.daily.map((d) => (
          <div key={d.day} title={`${fmtDay(d.day)}: ${d.visits} visits`} className="flex-1 rounded-t bg-red-500/70"
            style={{ height: `${Math.max(2, (d.visits / max) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{fmtDay(t.daily[0].day)}</span><span>Today</span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Top pages</p>
          {t.topPages.length === 0 ? <p className="mt-1 text-[13px] text-muted-foreground">No visits yet.</p> : (
            <ul className="mt-1 space-y-1">
              {t.topPages.map((p) => (
                <li key={p.path} className="flex justify-between gap-3 text-[13px]"><span className="truncate text-foreground">{p.path}</span><span className="tabular-nums text-muted-foreground">{p.views}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Where visitors come from</p>
          {t.topReferrers.length === 0 ? <p className="mt-1 text-[13px] text-muted-foreground">Mostly direct visits so far.</p> : (
            <ul className="mt-1 space-y-1">
              {t.topReferrers.map((r) => (
                <li key={r.site} className="flex justify-between gap-3 text-[13px]"><span className="truncate text-foreground">{r.site}</span><span className="tabular-nums text-muted-foreground">{r.visits}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function siteUrl(host: string) {
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

export default async function StaffWebsitePage() {
  const session = await getSession();
  if (!session || !canAccess(session.role, "website")) redirect("/staff");

  // Only the business this login is working for — never another business's site.
  const business = await getBusiness(session.businessId);
  const domain = business?.custom_domain || business?.domain || null;
  const live = !!business?.modules?.website;
  const traffic = await trafficSummary(session.businessId).catch(() => null);

  const info: { label: string; value: React.ReactNode }[] = [
    { label: "Business", value: business?.name || "—" },
    {
      label: "Domain",
      value: domain ? (
        <a href={siteUrl(domain)} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline">
          {domain}
        </a>
      ) : (
        "Not set"
      ),
    },
    { label: "Tagline", value: business?.tagline || "—" },
    {
      label: "Brand colour",
      value: business?.brand_colour ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 rounded border border-border" style={{ background: business.brand_colour }} />
          {business.brand_colour}
        </span>
      ) : (
        "—"
      ),
    },
    { label: "Phone", value: business?.phone || "—" },
    { label: "Email", value: business?.email || "—" },
    { label: "Online ordering", value: business?.modules?.online_ordering ? "On" : "Off" },
  ];

  return (
    <div className="px-4 py-6 md:px-6 md:py-7">
      <div className="mx-auto max-w-[900px]">
        <h1 style={heading} className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Website Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage what customers see on your website: online ordering, search and social previews, which dishes are online, photos and traffic. Homepage text and photos are in Settings → General.
        </p>

        <div className="mt-5 rounded-[14px] border border-border bg-surface p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {business?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logo_url} alt="" className="h-10 w-10 rounded-lg border border-border object-contain" />
            )}
            <h2 style={heading} className="text-[17px] font-semibold text-foreground">Your website</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                live ? "bg-green-600/10 text-green-700" : "bg-muted text-muted-foreground"
              }`}
            >
              {live ? "Live" : "Website module off"}
            </span>
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {info.map((row) => (
              <div key={row.label}>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{row.label}</dt>
                <dd className="mt-0.5 text-[14px] text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13px] text-muted-foreground">
            Name, logo, tagline and contact details are edited in Settings → Business setup.
          </p>
        </div>

        <WebsiteConfigView />

        <WebsiteMenuPhotos />

        <div className="mt-5 rounded-[14px] border border-border bg-surface p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 style={heading} className="text-[17px] font-semibold text-foreground">Website traffic</h2>
            <span className="text-[12.5px] text-muted-foreground">Counted without cookies — no visitor can be identified.</span>
          </div>
          <TrafficCard t={traffic} />
        </div>

        <div className="mt-6 flex items-center gap-2">
          <h2 style={heading} className="text-[17px] font-semibold text-foreground">On this page</h2>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ROADMAP.map((f) => (
            <div key={f.title} className="rounded-[14px] border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-[20px]">{f.icon}</span>
                <h3 className="text-[15px] font-semibold text-foreground">{f.title}</h3>
                <span className="ml-auto rounded-full bg-green-600/10 px-2.5 py-0.5 text-[12px] font-semibold text-green-700">Available</span>
              </div>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
