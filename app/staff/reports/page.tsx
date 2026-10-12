import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import StaffReportsView from "@/components/staff/StaffReportsView";
import { tillInUse } from "@/lib/till-in-use";

export default async function StaffReportsPage() {
  const session = await getSession();
  if (!session || !canAccess(session.role, "reports")) {
    redirect("/staff");
  }
  return <StaffReportsView tillInUse={await tillInUse(session.businessId)} />;
}
