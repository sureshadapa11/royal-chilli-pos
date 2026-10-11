"use client";

import { useEffect, useState } from "react";
import { reloadOnceForStaleVersion } from "@/lib/chunk-error";

// Last line of defence: a crash in the root layout itself. It replaces the
// whole page (no site CSS loaded), so styles are inline.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [reloading, setReloading] = useState(false);
  // This site's own business (never a fixed one).
  const [brand, setBrand] = useState<{ name: string | null; tagline: string | null }>({ name: null, tagline: null });

  useEffect(() => {
    console.error("[global error]", error);
    if (reloadOnceForStaleVersion(error)) setReloading(true);
  }, [error]);

  useEffect(() => {
    fetch("/api/public/brand").then((r) => (r.ok ? r.json() : null)).then((d) => d && setBrand(d)).catch(() => {});
  }, []);

  const btn = { flex: 1, padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer" } as const;
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#FFFBEB", color: "#201B18", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          {reloading ? (
            <p style={{ fontSize: 14, color: "#7C716A" }}>Updating to the latest version…</p>
          ) : (
            <div style={{ maxWidth: 380 }}>
              <h1 style={{ fontFamily: "Georgia, serif", fontSize: 26, margin: "0 0 10px" }}>Oops! We&apos;ve hit a little hiccup. 🌶️</h1>
              <p style={{ fontSize: 15, color: "#7C716A", margin: 0 }}>Something went wrong while loading this page.</p>
              <p style={{ fontSize: 15, fontWeight: 700, margin: "4px 0 0" }}>Don&apos;t worry — the kitchen is still open!</p>
              <p style={{ fontSize: 14, color: "#7C716A", margin: "12px 0 0" }}>Please try again, or head back to {brand.name ?? "our"} homepage and continue exploring our menu.</p>
              <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                <button onClick={() => window.location.reload()} style={{ ...btn, background: "#E34234", color: "#fff", border: "none" }}>Try Again</button>
                <button onClick={() => (window.location.href = "/")} style={{ ...btn, background: "transparent", color: "#201B18", border: "1px solid #EFE4C9" }}>Back to Home</button>
              </div>
              <p style={{ fontSize: 12, color: "#7C716A", marginTop: 24 }}>If the problem keeps happening, please try refreshing the page or come back in a moment.</p>
              {brand.name && <p style={{ fontFamily: "Georgia, serif", fontSize: 18, margin: "20px 0 0" }}>{brand.name}</p>}
              {brand.tagline && <p style={{ fontSize: 12, color: "#7C716A", margin: 0 }}>{brand.tagline}</p>}
              {error.digest && <p style={{ fontSize: 11, color: "#7C716A", marginTop: 16 }}>Error ref: {error.digest}</p>}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
