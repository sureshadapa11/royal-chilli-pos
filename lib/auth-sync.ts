// Signing in, out or switching business must leave nothing of the previous
// account on screen. A soft (client-side) navigation keeps the router cache
// and every component's state, so the old account's pages could still show
// until refreshed. Instead: full page load here, and tell the other open tabs
// (components/AuthSync.tsx) to reload too.

export type AuthArea = "staff" | "customer";

const CHANNEL = "rc-auth";
const STORAGE_KEY = "rc-auth-change"; // fallback for browsers without BroadcastChannel

// This tab's own id, sent with every message. BroadcastChannel delivers a
// message to every listener except the sending channel object — including the
// AuthSync listener in this same tab — so without it, signing in reloaded the
// sign-in page in a race with going to the next page, and people landed back
// on the sign-in page (already signed in, with no error).
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
// Set once this tab is on its way to a fresh page: nothing should reload it now.
let leaving = false;

type AuthMessage = { area?: string; at?: number; from?: string };

/** Should a listener in this tab act on `msg`? Not on its own, nor while leaving. Pure apart from the tab state. */
export function isFromAnotherTab(msg: AuthMessage | null | undefined): boolean {
  return !leaving && !!msg && msg.from !== TAB_ID;
}

/** Staff Hub, till, kitchen and staff sign-in — everything else is the website. */
export function areaOfPath(pathname: string): AuthArea {
  return /^\/(staff|pos|pin|login|print-station|os)(\/|$)/.test(pathname) ? "staff" : "customer";
}

export function announceAuthChange(area: AuthArea) {
  const msg = { area, at: Date.now(), from: TAB_ID };
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msg)); } catch { /* private mode */ }
  }
}

/** After sign-in / sign-out / switching business: tell other tabs, then load `dest` fresh. */
export function freshStart(dest: string, area: AuthArea = "staff") {
  leaving = true;
  announceAuthChange(area);
  window.location.replace(dest);
}

/** Listen for another tab's sign-in / sign-out. Returns a cleanup function. */
export function onAuthChange(handler: (area: AuthArea) => void): () => void {
  let ch: BroadcastChannel | null = null;
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const msg = JSON.parse(e.newValue) as AuthMessage;
      if (isFromAnotherTab(msg)) handler(msg.area as AuthArea);
    } catch { /* ignore */ }
  };
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => { if (isFromAnotherTab(e.data)) handler(e.data.area); };
  } catch {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    ch?.close();
    window.removeEventListener("storage", onStorage);
  };
}
