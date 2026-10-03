import { NextRequest, NextResponse } from "next/server";
import { appPrefix } from "@/lib/app-hosts";

// A business's pos.<domain> opens the till and staff.<domain> the Staff Hub
// (lib/app-hosts.ts). Only the bare address is redirected; every other path,
// and www./*.vercel.app, behave exactly as before.
export function middleware(req: NextRequest) {
  const prefix = appPrefix(req.headers.get("host"));
  if (prefix === "pos") return NextResponse.redirect(new URL("/pos", req.url));
  if (prefix === "staff") return NextResponse.redirect(new URL("/staff", req.url));
  return NextResponse.next();
}

export const config = { matcher: "/" };
