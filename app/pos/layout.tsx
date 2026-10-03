import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { TILL_COOKIE, verifyTillToken } from "@/lib/till-device";
import { Toaster } from "@/components/ui/toaster";
import NewOrderAlerts from "@/components/pos/NewOrderAlerts";
import IdleLogout from "@/components/pos/IdleLogout";

export const metadata: Metadata = { title: "Till", robots: { index: false } };

export default async function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const till = await verifyTillToken((await cookies()).get(TILL_COOKIE)?.value);

  if (!session) {
    // A paired till goes to the PIN pad; any other device to the password login.
    redirect(till ? "/pin" : "/login");
  }

  // Orders and payments only work on a paired till of this business (the
  // APIs refuse them elsewhere — lib/till-device.ts tillRequired); say so
  // up front rather than at the first failed payment.
  const notTill = !till || till.businessId !== session.businessId;

  return (
    <div style={{ fontFamily: "var(--font-space-grotesk)" }}>
      {notTill && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
          This device isn&apos;t a paired till — you can look things up, but orders and payments only work on a till.
        </div>
      )}
      {children}
      <NewOrderAlerts />
      <IdleLogout />
      <Toaster />
    </div>
  );
}
