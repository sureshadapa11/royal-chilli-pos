import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { bizDb } from "@/lib/business-db";
import { websiteBusinessId } from "@/lib/business";
import { londonDateStr } from "@/lib/london-date";

// POST { path, ref } — one page view on a business's public website (sent by
// components/site/PageViewTracker). Cookieless: the visitor is a one-way hash
// of a secret, the UK day, the IP and the browser, so it changes every day
// and can't identify anyone (no cookie, no consent needed). Bots and the
// staff/till pages are ignored. Staff Hub → Website shows the totals.

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|pingdom|uptime/i;
const NOT_PUBLIC = /^\/(staff|pos|pin|login|api|print-station|os|og)(\/|$)/;
const SECRET = process.env.JWT_SECRET || "royal-chilli-pos-fallback-secret-key-2024";

export async function POST(req: NextRequest) {
  const ua = req.headers.get("user-agent") || "";
  if (!ua || BOT.test(ua)) return new NextResponse(null, { status: 204 });

  const body = await req.json().catch(() => null);
  const raw = typeof body?.path === "string" ? body.path : "";
  // Path only — no query string (it can hold order or customer details).
  const path = raw.split(/[?#]/)[0].slice(0, 200);
  if (!path.startsWith("/") || NOT_PUBLIC.test(path)) return new NextResponse(null, { status: 204 });

  // Where they came from: just the other site's name, never our own.
  const host = req.headers.get("host");
  let referrer: string | null = null;
  try {
    const r = typeof body?.ref === "string" && body.ref ? new URL(body.ref).hostname.replace(/^www\./, "") : null;
    if (r && host && !host.replace(/^www\./, "").endsWith(r) && !r.endsWith(host.replace(/^www\./, ""))) referrer = r.slice(0, 100);
  } catch { /* not a URL */ }

  const day = londonDateStr();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  const visitor = createHash("sha256").update(`${SECRET}|${day}|${ip}|${ua}`).digest("hex").slice(0, 32);

  try {
    const businessId = await websiteBusinessId(host);
    const db = bizDb(businessId);
    await db.from("page_views").insert({ day, visitor, path, referrer });
    // Keep 13 months: tidy up now and then.
    if (Math.random() < 0.01) {
      const cutoff = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
      await db.from("page_views").delete().lt("day", cutoff);
    }
  } catch (error) {
    console.error("Page view error:", error);
  }
  return new NextResponse(null, { status: 204 });
}
