"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Counts one page view per page the visitor opens on the public website
// (app/api/track — cookieless, nothing stored in the browser). Staff Hub →
// Website → Website traffic shows the totals.
export default function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    const body = JSON.stringify({ path: pathname, ref: document.referrer || "" });
    try {
      if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) return;
    } catch { /* fall back to fetch */ }
    fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }, [pathname]);
  return null;
}
