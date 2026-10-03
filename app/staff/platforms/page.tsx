import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { tradingDayStr } from "@/lib/london-date";
import PlatformSalesView from "@/components/staff/PlatformSalesView";

export default async function PlatformsPage() {
  const session = await getSession();
  if (!session || !canAccess(session.role, "delivery_platforms")) redirect("/staff");
  return <PlatformSalesView today={tradingDayStr()} />;
}
