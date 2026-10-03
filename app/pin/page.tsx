import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { TILL_COOKIE, verifyTillToken } from "@/lib/till-device";
import PinPad from "./PinPad";

export const metadata: Metadata = { title: "Till sign in", robots: { index: false } };

// The till's sign-in screen: staff enter their 4-digit PIN. Only on a paired
// till (lib/till-device.ts) — anywhere else it points to the password login.
export default async function PinPage() {
  if (await getSession()) redirect("/pos");
  const till = await verifyTillToken((await cookies()).get(TILL_COOKIE)?.value);

  if (!till) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-2 text-lg font-bold text-foreground">This device isn&apos;t set up as a till</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A manager signs in on this device, then goes to Staff Hub &rarr; Settings &rarr; &ldquo;Make this device a till&rdquo;. After that, staff sign in here with their PIN.
          </p>
          <Link href="/login" className="mt-4 inline-block rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-400">
            Manager sign in
          </Link>
        </div>
      </div>
    );
  }

  return <PinPad />;
}
