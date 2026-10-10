import { bizDb } from "@/lib/business-db";
import { listBusinesses } from "@/lib/business";
import { getPnl } from "@/lib/finance";
import { savedDays } from "@/lib/daily-accounts";
import { summariseFeedback, topicLabel, NEEDS_CALL_BACK, type FeedbackRow } from "@/lib/feedback";
import { tradingDayStr, tradingRangeUtc } from "@/lib/london-date";
import { sendWeeklyReportEmail, type WeeklyReportData } from "@/lib/email";
import { PORTAL_HOSTS } from "@/lib/app-hosts";
import { winBackStats } from "@/lib/winback";

// Every Monday morning: last week (Mon–Sun) for each open business, emailed to
// the business's own address and its accounts address (Settings → Business
// setup). Sales and profit are the same figures as the dashboard's Summary;
// feedback is what guests said on "How was your meal?".

const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const short = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

/** The week just finished, as of `today`: Monday to Sunday. */
export function lastWeek(today: string): { from: string; to: string; label: string } {
  const from = addDays(mondayOf(today), -7);
  const to = addDays(from, 6);
  return { from, to, label: `${short(from, { weekday: "short", day: "numeric" })} – ${short(to, { weekday: "short", day: "numeric", month: "short" })}` };
}

export async function buildWeeklyReport(businessId: number, today = tradingDayStr()): Promise<WeeklyReportData> {
  const week = lastWeek(today);
  const before = { from: addDays(week.from, -7), to: addDays(week.to, -7) };
  const { start, end } = tradingRangeUtc(week.from, week.to);
  const [pnl, pnlBefore, sheets, { data: fb }, { count: open }, winBack] = await Promise.all([
    getPnl(businessId, week.from, week.to),
    getPnl(businessId, before.from, before.to),
    savedDays(businessId, week.from, week.to),
    bizDb(businessId).from("guest_feedback")
      .select("id, created_at, rating, liked, improve, comment, name, phone, email, contact_ok, customer_id, source, table_label, handled_at, handled_note")
      .gte("created_at", start).lte("created_at", end).order("created_at"),
    bizDb(businessId).from("guest_feedback").select("id", { count: "exact", head: true }).lte("rating", NEEDS_CALL_BACK).is("handled_at", null),
    winBackStats(businessId, start, end),
  ]);
  const rows = (fb ?? []) as FeedbackRow[];
  const s = summariseFeedback(rows);
  return {
    businessId,
    weekLabel: week.label,
    sales: pnl.sales.total, profit: pnl.profit, costs: pnl.costs.total,
    salesBefore: pnlBefore.sales.total || null,
    daysEntered: sheets.filter((r) => r.status === "submitted").length,
    feedback: { count: s.count, average: s.average, stars: s.stars, liked: s.liked.map((t) => `${t.label} (${t.count})`), improve: s.improve.map((t) => `${t.label} (${t.count})`) },
    unhappy: rows.filter((r) => r.rating <= NEEDS_CALL_BACK).map((r) => ({
      when: new Date(r.created_at).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }),
      rating: r.rating,
      who: [r.name, r.phone, r.email].filter(Boolean).join(" · ") || (r.table_label ? `Table ${r.table_label}` : "No name given"),
      comment: [r.improve.map(topicLabel).join(", "), r.comment].filter(Boolean).join(" — ") || null,
      handled: !!r.handled_at,
    })),
    openToFollowUp: open ?? 0,
    winBack: { sent: winBack.sent, answered: winBack.answered, reasons: winBack.reasons.map((r) => `${r.label} (${r.count})`) },
    // The shared staff sign-in works for every business, whatever its DNS.
    dashboardUrl: `https://${PORTAL_HOSTS[0]}/staff`,
    feedbackUrl: `https://${PORTAL_HOSTS[0]}/staff/customers?tab=feedback`,
  };
}

/** Send every open business its report. Returns who it went to. */
export async function sendWeeklyReports(): Promise<{ business: string; to: string[] }[]> {
  const out: { business: string; to: string[] }[] = [];
  for (const b of await listBusinesses()) {
    if (!b.active) continue;
    const to = [...new Set([b.email, b.accounts_email].filter((e): e is string => !!e && /@/.test(e)).map((e) => e.trim().toLowerCase()))];
    if (!to.length) continue;
    try {
      const report = await buildWeeklyReport(b.id);
      for (const addr of to) await sendWeeklyReportEmail(addr, report);
      out.push({ business: b.name, to });
    } catch (err) {
      console.error(`Weekly report failed for ${b.name}:`, err);
    }
  }
  return out;
}
