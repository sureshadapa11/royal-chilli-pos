import { getBusiness } from "@/lib/business";
import { addDays } from "@/lib/admin-dashboard";
import { tradingDayStr } from "@/lib/london-date";
import { businessForToken } from "@/lib/staff-links";
import { DayEndForm } from "@/components/links/StaffLinkForms";
import LinkExpired from "@/components/links/LinkExpired";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ date?: string }> }) {
  const { token } = await params;
  // ?date= (the reminder email's button) opens the form on that day.
  const today = tradingDayStr();
  const asked = (await searchParams).date ?? "";
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today && asked >= addDays(today, -31) ? asked : undefined;
  const businessId = await businessForToken(token);
  if (!businessId) return <LinkExpired />;
  const name = (await getBusiness(businessId))?.name ?? "Staff";
  return <DayEndForm token={token} business={name} today={today} startDate={startDate} />;
}
