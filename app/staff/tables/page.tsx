import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccess, canEdit } from "@/lib/permissions";
import TableManagementView from "@/components/staff/TableManagementView";

export default async function StaffTablesPage() {
  const session = await getSession();
  if (!session || !canAccess(session.role, "tables")) {
    redirect("/staff");
  }
  return <TableManagementView canEdit={canEdit(session.role, "tables")} />;
}
