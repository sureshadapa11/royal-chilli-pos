import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/staff-dashboard";
import { getAdminDashboard, RANGES, type RangeKey } from "@/lib/admin-dashboard";
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

// Admins get the sales & costs dashboard; managers and HR keep their
// day-to-day operations view.
export default async function StaffHubPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const session = await getSession();
  const role = session?.role;
  // Drivers only have their deliveries screen in the hub.
  if ((role as string) === "driver") redirect("/staff/drivers");
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

  if (role === "admin") {
    const { range } = await searchParams;
    // Summary offers whole weeks and months; an old ?range=today link gets this week.
    const key: RangeKey = range && range in RANGES && range !== "today" ? (range as RangeKey) : "this_week";
    const data = await getAdminDashboard(session!.businessId, key);
    // The group owner sees every business first, then the one they're working in.
    const group = session!.owner ? await getGroupOverview(key) : null;
    return (
      <div className="px-4 pb-12 pt-6 md:px-6">
        <div className="mx-auto max-w-[1240px]">
          {header}
          {group && <GroupOverview data={group} current={session!.businessId} />}
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
