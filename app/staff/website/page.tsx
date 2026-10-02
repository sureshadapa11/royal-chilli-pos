import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { getBusiness } from "@/lib/business";
import WebsiteConfigView from "@/components/staff/WebsiteConfigView";

const heading = { fontFamily: "var(--font-space-grotesk)" };

// What's planned for this tab, and what's built so far.
const ROADMAP = [
  { icon: "🏠", title: "Homepage content", text: "Edit opening hours, specials, the about section and banners shown on your homepage.", done: true },
  { icon: "🔎", title: "SEO", text: "Page titles, descriptions and social-sharing previews so customers find you on search.", done: true },
  { icon: "📊", title: "Analytics", text: "Visitors, popular pages and how many website visits turn into orders.", done: false },
  { icon: "📸", title: "Menu & photos", text: "Choose which dishes appear online and upload photos for your menu and gallery.", done: false },
];

// Placeholder cards until a Google Analytics property can be linked.
const TRAFFIC = [
  { label: "Visitors (last 30 days)" },
  { label: "Top pages" },
  { label: "Visits that order" },
];

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
          Manage what customers see on your website: homepage content, search and social previews, and online ordering.
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

        <div className="mt-5 rounded-[14px] border border-border bg-surface p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 style={heading} className="text-[17px] font-semibold text-foreground">Website traffic</h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground">Coming soon</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {TRAFFIC.map((t) => (
              <div key={t.label} className="rounded-lg border border-dashed border-border p-3">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{t.label}</p>
                <p className="mt-1 text-[22px] font-semibold text-muted-foreground" aria-label="Not available yet">—</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">
            Analytics coming soon. Link a Google Analytics property in{" "}
            <Link href="/staff/settings?tab=setup" className="text-red-600 hover:underline">Settings → Business setup</Link>.
          </p>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <h2 style={heading} className="text-[17px] font-semibold text-foreground">Roadmap</h2>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ROADMAP.map((f) => (
            <div key={f.title} className={`rounded-[14px] border bg-surface p-4 ${f.done ? "border-border" : "border-dashed border-border"}`}>
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-[20px]">{f.icon}</span>
                <h3 className="text-[15px] font-semibold text-foreground">{f.title}</h3>
                <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${f.done ? "bg-green-600/10 text-green-700" : "bg-red-600/10 text-red-600"}`}>
                  {f.done ? "Available" : "Coming soon"}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
