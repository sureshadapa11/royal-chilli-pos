"use client";

import { useEffect } from "react";
import { areaOfPath, onAuthChange } from "@/lib/auth-sync";

// Keeps every open tab on the account that's actually signed in:
// - another tab signed in, out or switched business → reload this one (a staff
//   page with no session goes to the sign-in page; a new account sees its own);
// - a staff or customer-account page brought back by the Back button from the
//   browser's memory (back/forward cache) → reload it, so a signed-out
//   account's page can't reappear.
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
    return () => { stop(); window.removeEventListener("pageshow", onShow); };
  }, []);
  return null;
}
