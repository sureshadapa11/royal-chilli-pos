"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { freshStart } from "@/lib/auth-sync";

// On a paired till (lib/till-device.ts), signs the person out after 5
// minutes of no use, back to the PIN screen — so the next person's orders
// are never recorded against whoever forgot to log out. Only once staff PINs
// exist (otherwise nobody could get back in without a password), never on the
// Kitchen Display or print pages, and never on a manager's own phone/laptop.

const IDLE_MS = 5 * 60_000;

export default function IdleLogout() {
  const pathname = usePathname() ?? "";
  const exempt = pathname.startsWith("/pos/kitchen") || pathname.startsWith("/pos/receipt");

  useEffect(() => {
    if (exempt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let last = Date.now();
    const touch = () => { last = Date.now(); };

    Promise.all([
      fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/staff-pin", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([me, pins]) => {
        if (cancelled || !me?.till || !((pins?.pins_set ?? 0) > 0)) return;
        window.addEventListener("pointerdown", touch, { capture: true });
        window.addEventListener("keydown", touch, { capture: true });
        timer = setInterval(async () => {
          if (Date.now() - last < IDLE_MS) return;
          clearInterval(timer);
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          freshStart("/pin");
        }, 15_000);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("pointerdown", touch, { capture: true });
      window.removeEventListener("keydown", touch, { capture: true });
    };
  }, [exempt]);

  return null;
}
