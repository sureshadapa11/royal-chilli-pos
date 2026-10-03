import { bizDb } from "@/lib/business-db";
import { londonDateStr } from "@/lib/london-date";

// Staff Hub → Website → Website traffic: totals from page_views (counted by
// app/api/track, cookieless). A "visit" is one visitor on one day — the
// visitor hash changes daily, so the same person on two days is two visits.
// "Visits that order" reached the order confirmation page that day.

export type TrafficSummary = {
  days: number;
  visits: number;
  pageViews: number;
  orderingVisits: number;
  topPages: { path: string; views: number }[];
  topReferrers: { site: string; visits: number }[];
  daily: { day: string; visits: number }[];
};

const ORDER_DONE = /^\/order\/confirmation/;

function label(path: string): string {
  if (path === "/") return "Home";
  return path;
}

export async function trafficSummary(businessId: number, days = 30): Promise<TrafficSummary> {
  const today = londonDateStr();
  const from = new Date(today + "T12:00:00Z");
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const fromStr = from.toISOString().slice(0, 10);

  // Page through — a busy month can be more than one batch.
  const rows: { day: string; visitor: string; path: string; referrer: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bizDb(businessId)
      .from("page_views")
      .select("day, visitor, path, referrer")
      .gte("day", fromStr)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000 || rows.length >= 200_000) break;
  }

  const visits = new Set<string>();
  const ordering = new Set<string>();
  const perDay = new Map<string, Set<string>>();
  const pages = new Map<string, number>();
  const referrers = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.day}|${r.visitor}`;
    visits.add(key);
    if (ORDER_DONE.test(r.path)) ordering.add(key);
    if (!perDay.has(r.day)) perDay.set(r.day, new Set());
    perDay.get(r.day)!.add(r.visitor);
    pages.set(label(r.path), (pages.get(label(r.path)) ?? 0) + 1);
    if (r.referrer) {
      if (!referrers.has(r.referrer)) referrers.set(r.referrer, new Set());
      referrers.get(r.referrer)!.add(key);
    }
  }

  const daily: { day: string; visits: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(fromStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    daily.push({ day, visits: perDay.get(day)?.size ?? 0 });
  }

  return {
    days,
    visits: visits.size,
    pageViews: rows.length,
    orderingVisits: ordering.size,
    topPages: [...pages.entries()].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views).slice(0, 8),
    topReferrers: [...referrers.entries()].map(([site, v]) => ({ site, visits: v.size })).sort((a, b) => b.visits - a.visits).slice(0, 5),
    daily,
  };
}
