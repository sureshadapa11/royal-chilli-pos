import type { Metadata } from "next";
import { headers } from "next/headers";
import { loginBrand } from "@/lib/login-brand";
import LoginForm from "./LoginForm";

type Props = { searchParams: Promise<{ b?: string | string[] }> };

// The business is decided by the domain the page was opened on, or ?b=<slug>
// for a business without its own domain yet. An unknown domain shows a
// neutral screen rather than another business's branding.
async function brandFor(searchParams: Props["searchParams"]) {
  const { b } = await searchParams;
  return loginBrand((await headers()).get("host"), typeof b === "string" ? b : null);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const brand = await brandFor(searchParams);
  return { title: brand.found ? `Staff Login — ${brand.name}` : "Staff Login", robots: { index: false } };
}

export default async function LoginPage({ searchParams }: Props) {
  return <LoginForm brand={await brandFor(searchParams)} />;
}
