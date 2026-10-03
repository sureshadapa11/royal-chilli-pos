import { NextRequest, NextResponse } from "next/server";
import { appPrefix, isPortalHost } from "@/lib/app-hosts";

// A business's pos.<domain> opens the till and staff.<domain> the Staff Hub,
// and the shared sign-in (crewportal) opens the Staff Hub sign-in rather than
// a business's website (lib/app-hosts.ts). Only the bare address is
// redirected; every other path, and www./*.vercel.app, behave as before.
export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  if (isPortalHost(host)) return NextResponse.redirect(new URL("/staff", req.url));
  const prefix = appPrefix(host);
  if (prefix === "pos") return NextResponse.redirect(new URL("/pos", req.url));
  if (prefix === "staff") return NextResponse.redirect(new URL("/staff", req.url));
  return NextResponse.next();
}

export const config = { matcher: "/" };
