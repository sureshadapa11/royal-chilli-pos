import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageStaff } from "@/lib/permissions";
import StaffLocationAssignments from "@/components/staff/StaffLocationAssignments";

export default async function StaffAssignmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !canManageStaff(session.role)) {
    redirect("/staff");
  }
  const staffId = Number((await params).id);
  if (!Number.isInteger(staffId) || staffId < 1) notFound();
  return <StaffLocationAssignments staffId={staffId} />;
}
