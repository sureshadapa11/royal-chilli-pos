"use client";

import { usePathname } from "next/navigation";

// The page shown when something goes wrong (app/error.tsx) or a page doesn't
// exist (app/not-found.tsx) — one design for both, for whichever business's
// site it's on. Customers get the friendly page with the menu, booking and
// ordering buttons; the till, Staff Hub, staff links and Print Station get a
// short one with a button back to the start of their own area.

export type Brand = { name: string | null; tagline: string | null };

const STAFF_AREAS = ["/pos", "/staff", "/os", "/pin", "/print-station", "/login", "/l"];

export default function BrandedFallback({ kind, brand, onRetry, digest }: {
  kind: "error" | "notfound";
  brand: Brand;
  onRetry?: () => void;
  digest?: string;
}) {
  const pathname = usePathname() || "/";
  const notFound = kind === "notfound";
  const staffArea = STAFF_AREAS.find((a) => pathname === a || pathname.startsWith(`${a}/`));

  if (staffArea) {
    // "Home" is the start of their own area, never the website.
    const home = staffArea === "/staff" ? "/staff" : staffArea === "/login" ? "/login"
      : staffArea === "/l" ? `/l/${pathname.split("/")[2] ?? ""}` : "/pos";
    return (
      <div className="mx-auto grid min-h-[60vh] max-w-sm place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">{notFound ? "Page not found 🌶️" : "Something went wrong 🌶️"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {notFound ? "This page doesn't exist, or the link is out of date." : "We're sorry — this page couldn't be loaded properly."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {notFound ? "Go back to the start and try again from there." : "Please try again. If the problem continues, go back to the start and try again in a moment."}
          </p>
          <div className={`mt-5 grid gap-2 ${onRetry ? "grid-cols-2" : "grid-cols-1"}`}>
            {onRetry && <button onClick={onRetry} className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">Try Again</button>}
            <a href={home} className={onRetry ? "rounded-xl border border-border px-4 py-3 text-sm font-semibold" : "rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white"}>Back to Home</a>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">If you still need help, please ask your manager.</p>
          {digest && <p className="mt-3 text-[11px] text-muted-foreground">Error ref: {digest}</p>}
        </div>
      </div>
    );
  }

  const primary = "rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground";
  const secondary = "rounded-xl border border-border px-4 py-3 text-sm font-semibold";
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-[family-name:var(--font-playfair)] text-3xl">
        {notFound ? "Sorry, we can't find that page. 🌶️" : "Oops! We've hit a little hiccup. 🌶️"}
      </h1>
      <p className="mt-3 text-muted-foreground">
        {notFound ? "The page may have moved, or the link might be out of date." : "Something went wrong while loading this page."}
      </p>
      <p className="mt-1 font-semibold">Don&apos;t worry — the kitchen is still open!</p>
      <p className="mt-3 text-sm text-muted-foreground">
        {notFound ? "Head back to" : "Please try again, or head back to"} {brand.name ?? "our"} homepage and continue exploring our menu.
      </p>
      <div className={`mt-5 grid gap-2 ${onRetry ? "grid-cols-2" : "grid-cols-1"}`}>
        {onRetry && <button onClick={onRetry} className={primary}>Try Again</button>}
        <a href="/" className={onRetry ? secondary : primary}>Back to Home</a>
      </div>

      <h2 className="mt-10 font-[family-name:var(--font-playfair)] text-xl">Hungry already?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Explore our menu, book a table, or order your favourites online.</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <a href="/menu" className={secondary}>View Menu</a>
        <a href="/reservations" className={secondary}>Book a Table</a>
        <a href="/order" className={secondary}>Order Online</a>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        {notFound ? "Typed the address? Check it for a small mistake." : "If the problem keeps happening, please try refreshing the page or come back in a moment."}
      </p>
      {brand.name && <p className="mt-6 font-[family-name:var(--font-playfair)] text-lg">{brand.name}</p>}
      {brand.tagline && <p className="text-xs text-muted-foreground">{brand.tagline}</p>}
      {digest && <p className="mt-4 text-[11px] text-muted-foreground">Error ref: {digest}</p>}
    </div>
  );
}
