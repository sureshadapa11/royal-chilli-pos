"use client";

import { useEffect, useState } from "react";
import { reloadOnceForStaleVersion } from "@/lib/chunk-error";
import BrandedFallback, { type Brand } from "@/components/site/BrandedFallback";

// Any page that crashes lands here instead of the bare "Application error"
// text. An out-of-date page (opened before a new version went live) reloads
// itself once, silently. The page names this site's own business (never a
// fixed one), looked up from /api/public/brand.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false);
  const [brand, setBrand] = useState<Brand>({ name: null, tagline: null });

  useEffect(() => {
    console.error("[page error]", error);
    if (reloadOnceForStaleVersion(error)) setReloading(true);
  }, [error]);

  useEffect(() => {
    fetch("/api/public/brand").then((r) => (r.ok ? r.json() : null)).then((d) => d && setBrand(d)).catch(() => {});
  }, []);

  if (reloading) {
    return <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">Updating to the latest version…</div>;
  }

  const tryAgain = () => {
    reset();
    window.location.reload();
  };
  return <BrandedFallback kind="error" brand={brand} onRetry={tryAgain} digest={error.digest} />;
}
