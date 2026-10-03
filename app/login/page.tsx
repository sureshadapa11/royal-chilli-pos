import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { loginBrand } from "@/lib/login-brand";
import { ogImageUrl } from "@/lib/app-hosts";
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
  const title = brand.found ? `Staff sign in — ${brand.name}` : "Staff sign in";
  const description = brand.found ? `Staff sign-in for ${brand.name}.` : "Staff sign-in. Enter your business code to continue.";
  const code = brand.found && brand.viaCode && brand.code ? `?code=${encodeURIComponent(brand.code)}` : "";
  const image = ogImageUrl((await headers()).get("host"), code);
  return {
    title,
    description,
    robots: { index: false },
    // The picture shown when the link is shared (app/og): this business's
    // logo and name, or a neutral Crew Portal card.
    openGraph: { title, description, ...(image ? { images: [{ url: image, width: 1200, height: 630 }] } : {}) },
    twitter: { card: "summary_large_image" },
  };
}

export default async function LoginPage({ searchParams }: Props) {
  return <LoginForm brand={await brandFor(searchParams)} />;
}
