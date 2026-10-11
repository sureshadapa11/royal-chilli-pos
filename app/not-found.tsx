import type { Metadata } from "next";
import { getBusiness, pageBusinessId } from "@/lib/business";
import BrandedFallback from "@/components/site/BrandedFallback";

// Any address that doesn't exist: the same design as the "something went
// wrong" page, with this site's own business name and tagline.
export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default async function NotFound() {
  const b = await getBusiness(await pageBusinessId()).catch(() => null);
  return <BrandedFallback kind="notfound" brand={{ name: b?.name ?? null, tagline: b?.tagline ?? null }} />;
}
