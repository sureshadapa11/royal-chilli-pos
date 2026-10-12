import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { tradingDayStr } from "@/lib/london-date";
import DailyAccountsPage from "@/components/staff/DailyAccountsPage";
import { accountsAccess } from "@/lib/accounts-access";
import { cookies } from "next/headers";
import { ALL_BUSINESSES_COOKIE } from "@/lib/owner-view";
import { listBusinesses } from "@/lib/business";
import AllBusinessesAccounts from "@/components/staff/AllBusinessesAccounts";

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string; month?: string }> }) {
  const session = await getSession();
  const access = session ? accountsAccess(session) : null;
  if (!session || !access || access.tabs.length === 0) redirect("/staff");
  const today = tradingDayStr();
  // ?date= from the reminder opens that day; ?month= (Summary → Open sheet) opens the month.
  const { date, month } = await searchParams;
  const start = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const startMonth = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
  // Group owner with "Working in: All businesses": every business side by side.
  if (session.owner && (await cookies()).get(ALL_BUSINESSES_COOKIE)?.value === "1") {
    const list = (await listBusinesses()).map((b) => ({ id: b.id, name: b.name, active: !!b.active }));
    return <AllBusinessesAccounts startMonth={startMonth} businesses={list} />;
  }
  const business = await getBusiness(session.businessId).catch(() => null);
  return (
    <DailyAccountsPage today={today} start={start} startMonth={startMonth}
      startView={access.tabs.includes("day") ? (month && access.tabs.includes("month") ? "month" : "day") : access.tabs[0]}
      businessName={business?.name ?? "Daily accounts"} access={access} />
  );
}
