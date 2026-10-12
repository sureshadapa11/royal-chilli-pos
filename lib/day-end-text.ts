import type { DayEndReport } from "@/lib/day-end-report";

// A day's report as WhatsApp text (agreed 2026-10-12, like the INSOMNIA
// sheet's WhatsApp tab): *bold* headings, one line per figure, so the owner
// can send it to themselves in one tap. Pure, so it can be tested.

const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const sign = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${gbp(Math.abs(n))}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function dayEndText(r: DayEndReport): string {
  const L: string[] = [`*${r.business} – Daily Report*`, day(r.date), ""];
  const f = r.figures;
  if (!f) {
    L.push("⚠️ *Day End not entered*", "");
  } else {
    L.push(`*Day End* (by ${r.entered?.by ?? "—"})`);
    L.push(`Z report ${gbp(f.z_report)} · Card ${gbp(f.card)} · Cash ${gbp(f.cash)}`);
    if (f.tips) L.push(`Tips ${gbp(f.tips)}`);
    for (const p of f.platforms.filter((x) => x.sales || x.commission)) L.push(`${p.label} ${gbp(p.sales)}${p.commission ? ` (comm ${gbp(p.commission)})` : ""}`);
    if (f.catering_paid || f.catering_pending) L.push(`Catering paid ${gbp(f.catering_paid)} · pending ${gbp(f.catering_pending)}`);
    L.push(`*Total sales ${gbp(f.total_sales)}* · Net ${gbp(f.net_total)}`);
    if (r.notes) L.push(`Notes: ${r.notes}`);
    L.push("");
  }
  const d = r.drawer;
  L.push("*Cash drawer*");
  L.push(`Opening ${gbp(d.opening)} + cash sales ${gbp(d.cashSales)} + in ${gbp(d.moneyIn)} − out ${gbp(d.moneyOut)} − bank in ${gbp(d.bankIn)}`);
  L.push(`Expected ${gbp(d.expected)} · Counted ${gbp(d.counted)}`);
  L.push(d.variance == null ? "Variance: not counted" : `*Variance ${sign(d.variance)}*${Math.abs(d.variance) < 0.005 ? " ✅" : d.variance < 0 ? " ⚠️ missing" : " ⚠️ extra"}`);
  if (r.cash.length) {
    L.push("", "*Money in / out*");
    for (const c of r.cash) L.push(`${c.direction === "out" ? "OUT" : "IN"} ${gbp(c.amount)} · ${c.method} · ${c.category}${c.reason && c.reason !== c.category ? `: ${c.reason}` : ""} (${c.by})`);
  }
  const missing = r.missingDays.filter((x) => x !== r.date);
  if (missing.length) L.push("", `⚠️ Day End also missing: ${missing.map(shortDay).join(", ")}`);
  return L.join("\n");
}

/** A WhatsApp link that opens a chat with this text (to `number`, or pick the chat). */
export function whatsAppUrl(text: string, number?: string | null): string {
  const n = (number ?? "").replace(/\D/g, "");
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
