import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { getBusiness } from "@/lib/business";
import SettingsView from "@/components/staff/SettingsView";
import BusinessSetupView from "@/components/staff/BusinessSetupView";
import BusinessesView from "@/components/staff/BusinessesView";
import TillDeviceCard from "@/components/staff/TillDeviceCard";
import { isManagerRole } from "@/lib/staff-pin";

const heading = { fontFamily: "var(--font-space-grotesk)" };

// Settings — one page, four tabs: General · Business setup · Roles &
// Permissions (Super admin only) · Businesses (owner only). The top menu's single "Settings"
// link opens it; each tab has its own address (?tab=…) so it can be linked to.
const TABS = [
  { key: "general", label: "General", icon: "⚙️" },
  { key: "setup", label: "Business setup", icon: "🏢" },
  { key: "permissions", label: "Roles & Permissions", icon: "🔐", superAdminOnly: true },
  { key: "businesses", label: "Businesses", icon: "🗂️", ownerOnly: true },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session || !(session.owner || canAccess(session.role, "settings"))) redirect("/staff");

  const tabs = TABS.filter((t) => (!("ownerOnly" in t) || session.owner) && (!("superAdminOnly" in t) || session.role === "admin"));
  const asked = (await searchParams).tab;
  const tab: TabKey = tabs.find((t) => t.key === asked)?.key ?? "general";
  const business = await getBusiness(session.businessId);

  return (
    <div className="px-4 pb-12 pt-6 md:px-6">
      <div className="mx-auto max-w-[1040px]">
        <h1 style={heading} className="flex flex-wrap items-center gap-2 text-[26px] font-semibold tracking-[-0.02em] text-foreground">
          Settings
          {business && (
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[12.5px] font-semibold tracking-normal text-muted-foreground">
              {business.name}
            </span>
          )}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Everything about how this business runs — in one place.</p>

        <nav aria-label="Settings" className="sticky top-0 z-20 -mx-4 mt-4 flex gap-1.5 overflow-x-auto border-b border-border bg-background px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/staff/settings?tab=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={`-mb-px flex flex-none items-center gap-1.5 whitespace-nowrap border-b-[2.5px] px-3.5 py-3 text-sm font-semibold ${
                t.key === tab ? "border-[#E34435] text-[#C82D1D]" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
              {"ownerOnly" in t && <span className="rounded-full bg-[#EFE9DC] px-1.5 text-[10.5px] font-bold text-[#6B6259]">Owner</span>}
            </Link>
          ))}
        </nav>

        <div className="pt-5">
          {tab === "general" && (
            <>
              {(session.owner || isManagerRole(session.role)) && <TillDeviceCard />}
              <SettingsView section="general" canEditPermissions={false} />
            </>
          )}
          {tab === "permissions" && <SettingsView section="permissions" canEditPermissions={session.role === "admin"} />}
          {tab === "setup" && (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                This business&apos;s details. The till, receipts, website and accountant export use what&apos;s entered here.
              </p>
              <BusinessSetupView />
            </>
          )}
          {tab === "businesses" && (
            <>
              <p className="mb-4 text-sm text-muted-foreground">Every business in the group. Each one runs on its own — only you can see across them.</p>
              <BusinessesView current={session.businessId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
