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
    // A tracked link (theroyalchilli.com/?src=bag) says which flyer, QR code
    // or post brought them.
    const src = new URLSearchParams(window.location.search).get("src") || "";
    const body = JSON.stringify({ path: pathname, ref: document.referrer || "", src });
    try {
      if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) return;
    } catch { /* fall back to fetch */ }
    fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }, [pathname]);
  return null;
}
