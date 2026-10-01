import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { canManageDrivers } from "@/lib/permissions";
import DriversView from "@/components/staff/DriversView";

// Drivers see their own deliveries; managers/admins see the roster and assign
// unassigned deliveries. Everyone else is sent back to the hub.
export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession();
  return { title: (session?.role as string) === "driver" ? "My Deliveries" : "Drivers" };
}

export default async function DriversPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isDriver = (session.role as string) === "driver";
  const isManager = !isDriver && canManageDrivers(session.role);
  if (!isDriver && !isManager) redirect("/staff");

  return <DriversView isManager={isManager} isDriver={isDriver} />;
}
