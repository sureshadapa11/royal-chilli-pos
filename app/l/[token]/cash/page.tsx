import { getBusiness } from "@/lib/business";
import { tradingDayStr } from "@/lib/london-date";
import { businessForToken } from "@/lib/staff-links";
import { CashForm } from "@/components/links/StaffLinkForms";
import LinkExpired from "@/components/links/LinkExpired";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const businessId = await businessForToken(token);
  if (!businessId) return <LinkExpired />;
  const name = (await getBusiness(businessId))?.name ?? "Staff";
  return <CashForm token={token} business={name} today={tradingDayStr()} />;
}
