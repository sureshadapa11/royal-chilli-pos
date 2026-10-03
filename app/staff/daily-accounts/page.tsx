import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { tradingDayStr } from "@/lib/london-date";
import DailyAccountsView from "@/components/staff/DailyAccountsView";

export default async function DailyAccountsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await getSession();
  if (!session || !canAccess(session.role, "finance")) redirect("/staff");
  const today = tradingDayStr();
  // ?date= from the reminder ("Enter yesterday's daily accounts"); never a future day.
  const { date } = await searchParams;
  const start = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  return <DailyAccountsView today={today} start={start} />;
}
