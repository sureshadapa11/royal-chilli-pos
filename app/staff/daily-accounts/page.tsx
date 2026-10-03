import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { getBusiness } from "@/lib/business";
import { tradingDayStr } from "@/lib/london-date";
import DailyAccountsPage from "@/components/staff/DailyAccountsPage";

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string; month?: string }> }) {
  const session = await getSession();
  if (!session || !canAccess(session.role, "daily_accounts")) redirect("/staff");
  const today = tradingDayStr();
  // ?date= from the reminder opens that day; ?month= (Summary → Open sheet) opens the month.
  const { date, month } = await searchParams;
  const start = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  const startMonth = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
  const business = await getBusiness(session.businessId).catch(() => null);
  return (
    <DailyAccountsPage today={today} start={start} startMonth={startMonth}
      startView={month ? "month" : "day"} businessName={business?.name ?? "Daily accounts"} />
  );
}
