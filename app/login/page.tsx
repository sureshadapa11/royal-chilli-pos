import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { loginBrand } from "@/lib/login-brand";
import { BUSINESS_COOKIE } from "@/lib/staff-business-code";
import LoginForm from "./LoginForm";

type Props = { searchParams: Promise<{ b?: string | string[]; code?: string | string[] }> };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

// The business is decided by the address (staff.<domain>), else the business
// code — typed here, or remembered on this device from last time — else a
// ?b=<slug> link. On the shared sign-in (crewportal.vercel.app/staff) with
// none of those, the page asks for the business code first.
async function brandFor(searchParams: Props["searchParams"]) {
  const sp = await searchParams;
  const code = one(sp.code) ?? (await cookies()).get(BUSINESS_COOKIE)?.value ?? null;
  return loginBrand((await headers()).get("host"), one(sp.b), code);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const brand = await brandFor(searchParams);
  return {
    title: brand.found ? `Staff sign in — ${brand.name}` : "Staff sign in",
    description: brand.found ? `Staff sign-in for ${brand.name}.` : "Staff sign-in. Enter your business code to continue.",
    robots: { index: false },
  };
}

export default async function LoginPage({ searchParams }: Props) {
  return <LoginForm brand={await brandFor(searchParams)} />;
}
