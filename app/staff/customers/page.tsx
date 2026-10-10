import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canViewCrm, canManageCrm } from "@/lib/permissions";
import CustomersView from "@/components/staff/CustomersView";
import { getBrand } from "@/lib/brand";

export default async function CustomersPage() {
  const session = await getSession();
  if (!session || !canViewCrm(session.role)) {
    redirect("/staff");
  }
  return <CustomersView isManager={canManageCrm(session.role)} businessName={(await getBrand(session.businessId)).name} />;
}
