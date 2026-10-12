import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import AnalyticsView from "@/components/staff/AnalyticsView";
import { tillInUse } from "@/lib/till-in-use";

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session || !canAccess(session.role, "analytics")) {
    redirect("/staff");
  }
  return <AnalyticsView tillInUse={await tillInUse(session.businessId)} />;
}
