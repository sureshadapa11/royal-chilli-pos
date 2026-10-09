"use client";

import { useEffect } from "react";
import { areaOfPath, onAuthChange } from "@/lib/auth-sync";

// Keeps every open tab on the account that's actually signed in:
// - another tab signed in, out or switched business → reload this one (a staff
//   page with no session goes to the sign-in page; a new account sees its own);
// - coming back to a staff tab → check who's signed in now, and reload if it
//   changed. This also catches a change made in the attendance app, which
//   shares the sign-in across subdomains where tabs can't message each other;
// - a staff or customer-account page brought back by the Back button from the
//   browser's memory (back/forward cache) → reload it, so a signed-out
//   account's page can't reappear.

const NO_CHECK = /^\/(login|pin)(\/|$)/; // pages for signing in — nobody to compare

async function whoIsSignedIn(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (res.status === 401) return "none";
    if (!res.ok) return null; // can't tell — leave the page alone
    const { user } = await res.json();
    return user ? `${user.id}:${user.businessId}` : "none";
  } catch {
    return null;
  }
}

export default function AuthSync() {
  useEffect(() => {
    const stop = onAuthChange((area) => {
      if (area === areaOfPath(window.location.pathname)) window.location.reload();
    });

    const onShow = (e: PageTransitionEvent) => {
      const path = window.location.pathname;
      if (e.persisted && (areaOfPath(path) === "staff" || path.startsWith("/account"))) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);

    const path = window.location.pathname;
    const checks = areaOfPath(path) === "staff" && !NO_CHECK.test(path);
    let signedIn: string | null = null;
    if (checks) whoIsSignedIn().then((who) => { signedIn = who; });
    const onVisible = async () => {
      if (!checks || document.visibilityState !== "visible" || signedIn === null) return;
      const now = await whoIsSignedIn();
      if (now !== null && now !== signedIn) window.location.reload();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stop();
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
