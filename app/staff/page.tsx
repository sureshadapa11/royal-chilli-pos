import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/staff-dashboard";
import { getAdminDashboard, mergeDashboards, RANGES, type RangeKey } from "@/lib/admin-dashboard";
import { cookies } from "next/headers";
import { listBusinesses } from "@/lib/business";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";
import StaffDashboard, { KpiCard } from "@/components/staff/StaffDashboard";
import AdminDashboard from "@/components/staff/AdminDashboard";
import GroupOverview from "@/components/staff/GroupOverview";
import { getBrand } from "@/lib/brand";
import { getGroupOverview } from "@/lib/group-dashboard";

const heading = { fontFamily: "var(--font-space-grotesk)" };

// Restaurant-local time of day, not the server's raw UTC clock — otherwise
// this could say "Good evening" at 2pm during British Summer Time.
function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Super admins and Managers get the sales & costs dashboard; HR keeps its
// people view.
export default async function StaffHubPage({ searchParams }: { searchParams: Promise<{ range?: string; summaryRange?: string }> }) {
  const session = await getSession();
  const role = session?.role;
  // Drivers only have their deliveries screen in the hub.
  if ((role as string) === "driver" || session?.deliver) redirect("/staff/drivers");
  const today = new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const firstName = session?.name?.split(" ")[0] ?? session?.name;

  const header = (
    <div className="mb-[18px]">
      <h1 style={heading} className="text-foreground text-[26px] font-semibold tracking-[-0.02em]">
        {greeting()}, {firstName}
      </h1>
      <p className="mt-[3px] text-sm text-muted-foreground">{today}</p>
    </div>
  );

  // Super admins and Managers: the sales & costs dashboard (a Manager only
  // ever sees their own business — no switcher, no All businesses table).
  if (role === "admin" || role === "manager") {
    const { range, summaryRange } = await searchParams;
    // Summary offers whole weeks and months. Accept the old `range` parameter
    // as a fallback so existing dashboard links keep working.
    const selectedRange = summaryRange ?? range;
    const key: RangeKey = selectedRange && selectedRange in RANGES && selectedRange !== "today" ? (selectedRange as RangeKey) : "this_week";
    // Owner with "Working in: All businesses": every business's dashboard combined.
    const allMode = !!session!.owner && (await cookies()).get(ALL_BUSINESSES_COOKIE)?.value === "1";
    const data = allMode
      ? mergeDashboards(await Promise.all((await listBusinesses()).map(async (b) => ({ name: b.name, data: await getAdminDashboard(b.id, key) }))))
      : await getAdminDashboard(session!.businessId, key);
    // The group owner sees every business first, then the one they're working in.
    const group = session!.owner ? await getGroupOverview("this_week") : null;
    return (
      <div className="px-4 pb-12 pt-6 md:px-6">
        <div className="mx-auto max-w-[1240px]">
          {header}
          {group && <GroupOverview data={group} current={session!.businessId} />}
          {allMode && (
            <p className="mb-3 mt-1 text-[13px] font-semibold text-[#5B524B]">
              Showing <span className="text-[#C82D1D]">all businesses combined</span> · pick one under &ldquo;Working in&rdquo; to see just that business
            </p>
          )}
          <AdminDashboard data={data} businessName={(await getBrand(session!.businessId)).name} />
        </div>
      </div>
    );
  }

  const data = session && role ? await getDashboardData(session.businessId, role) : { kpis: [], alerts: [] };
  return (
    <div className="px-4 py-6 md:px-6 md:py-7">
      <div className="mx-auto max-w-[1200px]">
        {header}

        {data.kpis.length > 0 && (
          <div className="mb-[18px] grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[14px]">
            {data.kpis.map((s, i) => (
              <KpiCard key={s.label} stat={s} id={i} />
            ))}
          </div>
        )}

        <StaffDashboard data={data} />
      </div>
    </div>
  );
}
