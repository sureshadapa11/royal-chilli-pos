import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { canAccess, isStaffManagement, canViewCrm, canManageDrivers } from "@/lib/permissions";
import { getHubNotifications } from "@/lib/hub-notifications";
import { listBusinesses } from "@/lib/business";
import { getBrand } from "@/lib/brand";
import StaffShell, { type NavGroup } from "@/components/staff/StaffShell";
import { Toaster } from "@/components/ui/toaster";
import NewOrderAlerts from "@/components/pos/NewOrderAlerts";
import { cookies } from "next/headers";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";

export const metadata: Metadata = { title: "Staff Hub", robots: { index: false } };

// Staff Hub is management-only (manager / hr / admin). Employees work from the
// POS; clock-in/out is the dedicated attendance app's kiosk. The menu only
// lists what the role can open, and each page still enforces its own check.
// Drivers get in too, but only see their own deliveries (every other page
// redirects them back, and /staff sends them to /staff/drivers).
export default async function StaffHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) redirect("/login");
  const isDriver = (session.role as string) === "driver" || !!session.deliver;
  if (!isStaffManagement(session.role) && !isDriver) redirect("/pos");

  const see = (tab: Parameters<typeof canAccess>[1]) => canAccess(session.role, tab);

  // First entry = the plain "Dashboard" link; the rest are dropdown groups.
  const nav: NavGroup[] = isDriver ? [
    { label: "", items: [{ href: "/staff/drivers", label: "My Deliveries", icon: "📦" }] },
  ] : [
    { label: "", items: [{ href: "/staff", label: "Dashboard", icon: "🏠" }] },
    {
      label: "Operations",
      items: [
        ...(see("menu") ? [{ href: "/staff/menu", label: "Menu", icon: "🍽️" }] : []),
        ...(see("tables") ? [{ href: "/staff/tables", label: "Tables", icon: "🪑" }] : []),
        ...(see("inventory") ? [{ href: "/staff/inventory", label: "Inventory", icon: "📦" }] : []),
        ...(canManageDrivers(session.role) ? [{ href: "/staff/drivers", label: "Drivers", icon: "🚗" }] : []),
        ...(see("delivery_platforms") ? [{ href: "/staff/platforms", label: "Delivery platforms", icon: "🛵", note: "Enter daily totals" }] : []),
        ...(see("daily_accounts") ? [{ href: "/staff/daily-accounts", label: "Daily accounts", icon: "🧮", note: "Day-end sheet" }] : []),
        ...(see("website") ? [{ href: "/staff/website", label: "Website", icon: "🌐" }] : []),
        ...(see("till") ? [{ href: "/pos", label: "Till", icon: "💷" }] : []),
      ],
    },
    {
      label: "People",
      items: [
        ...(see("attendance") ? [{ href: "/api/sso/attendance", label: "Attendance & Rota", icon: "⏱️", external: true }] : []),
        ...(see("hr") ? [{ href: "/staff/hr", label: "HR & Payroll", icon: "👥" }] : []),
        ...(canViewCrm(session.role) ? [{ href: "/staff/customers", label: "Customers & Loyalty", icon: "🎁" }] : []),
      ],
    },
    {
      label: "Insights",
      items: [
        ...(see("analytics") ? [{ href: "/staff/analytics", label: "Analytics", icon: "📈" }] : []),
        ...(see("reports") ? [{ href: "/staff/reports", label: "Reports", icon: "🧾" }] : []),
        ...(see("finance") ? [{ href: "/staff/finance", label: "Finance", icon: "💰" }] : []),
        ...(see("audit") ? [{ href: "/staff/audit-log", label: "Audit log", icon: "🔍" }] : []),
      ],
    },
    // One link — General, Business setup, Roles & Permissions and (owner)
    // Businesses are tabs on the Settings page.
    {
      label: "Settings",
      items: see("settings") || session.owner ? [{ href: "/staff/settings", label: "Settings", icon: "⚙️" }] : [],
    },
  ].filter((g, i) => i === 0 || g.items.length > 0);

  const notices = isDriver ? [] : await getHubNotifications(session.businessId, session.role).catch(() => []);
  const brand = await getBrand(session.businessId);
  // Only the group owner can step into other businesses.
  const switcher = session.owner
    ? (await listBusinesses()).map((b) => ({ id: b.id, name: b.name, active: b.active }))
    : undefined;

  // Owner chose "Working in: All businesses" (lib/owner-view).
  const allMode = !!session.owner && (await cookies()).get(ALL_BUSINESSES_COOKIE)?.value === "1";

  return (
    <StaffShell
      user={{ name: session.name, role: session.role }}
      business={{ id: session.businessId, name: brand.name, logoUrl: brand.logoUrl, tagline: brand.tagline }}
      switcher={switcher}
      allMode={allMode}
      nav={nav}
      notices={notices}
    >
      {children}
      {!isDriver && <NewOrderAlerts />}
      <Toaster />
    </StaffShell>
  );
}
