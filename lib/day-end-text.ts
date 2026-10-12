import type { DayEndReport } from "@/lib/day-end-report";

// A day's report as WhatsApp text (agreed 2026-10-12, style "A" from the
// mock-up): emoji section headings, *bold* totals, _italic_ notes, the cash
// drawer as a lined-up monospace block, and a coloured variance (🟢 £0,
// 🟠 extra, 🔴 missing) — so it reads at a glance in the owner's chat.
// Pure, so it can be tested.

const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const LINE = "━━━━━━━━━━━━━━━";
/** "9h 49m" — the same hours format as everywhere else. */
const hm = (seconds: number) => { const m = Math.round(seconds / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const METHOD_ICON: Record<string, string> = { Cash: "💵", Card: "💳", "Bank transfer": "🏦" };

/** One lined-up row of the monospace cash block: label left, amount right. */
const cashRow = (label: string, amount: string) => `${label.padEnd(13)}${amount.padStart(11)}`;

export function dayEndText(r: DayEndReport): string {
  const L: string[] = [`🌶️ *${r.business.toUpperCase()}*`, `📅 _${day(r.date)} · Daily report_`, LINE, ""];
  const f = r.figures;
  if (!f) {
    L.push("⚠️ *Day End not entered*", "");
  } else {
    L.push(`💷 *SALES  ${gbp(f.total_sales)}*`);
    L.push(`   🧾 VAT (20%)  ${gbp(f.sales_vat)} · Ex-VAT ${gbp(f.ex_vat)}`);
    L.push(`› 🧾 Z report  ${gbp(f.z_report)}`);
    for (const p of f.platforms.filter((x) => x.sales)) L.push(`› 🛵 ${p.label}  ${gbp(p.sales)}`);
    if (f.catering_paid) L.push(`› 🍱 Catering  ${gbp(f.catering_paid)}`);
    L.push(`› 💳 Card ${gbp(f.card)} · 💵 Cash ${gbp(f.cash)}`);
    if (f.tips) L.push(`› 🙏 Tips ${gbp(f.tips)} _(staff's, not sales)_`);
    L.push("");
    L.push(`📈 *Net (after costs)  ${gbp(f.net_total)}*`);
    if (f.fees) L.push(`💸 Commission & fees  ${gbp(f.fees)}`);
    L.push(`🏛️ VAT to pay (today)  ${gbp(f.vat_to_pay)}${f.vat_claimed ? ` _(claimed back ${gbp(f.vat_claimed)})_` : ""}`);
    if (f.catering_pending) L.push(`⏳ Catering still owed  ${gbp(f.catering_pending)}`);
    if (r.notes) L.push(`📝 _${r.notes}_`);
    L.push("");
  }

  // Who worked and for how long — hours only (agreed 2026-10-12).
  const shifts = r.shifts ?? [];
  if (shifts.length) {
    const worked = shifts.filter((s) => s.seconds > 0);
    const total = worked.reduce((t, s) => t + s.seconds, 0);
    L.push(LINE, `👥 *STAFF ON SHIFT  (${worked.length} · ${hm(total)})*`);
    for (const s of worked) L.push(`› ${s.name}  ${hm(s.seconds)}`);
    for (const s of shifts.filter((x) => x.stillIn)) L.push(`⚠️ ${s.name} still clocked in (since ${s.stillIn})`);
    L.push("");
  }

  const d = r.drawer;
  L.push(LINE, "💰 *CASH DRAWER*", "```");
  L.push(cashRow("Opening", gbp(d.opening)));
  if (d.cashSales) L.push(cashRow("+ Cash sales", gbp(d.cashSales)));
  if (d.moneyIn) L.push(cashRow("+ Money in", gbp(d.moneyIn)));
  if (d.moneyOut) L.push(cashRow("− Money out", gbp(d.moneyOut)));
  if (d.bankIn) L.push(cashRow("− Bank in", gbp(d.bankIn)));
  L.push(cashRow("= Expected", gbp(d.expected)));
  L.push(cashRow("  Counted", gbp(d.counted)));
  L.push("```");
  if (d.variance == null) L.push("⚪ _Variance: not counted_");
  else if (Math.abs(d.variance) < 0.005) L.push("🟢 *Variance £0.00 (all correct)*");
  else if (d.variance > 0) L.push(`🟠 *Variance +${gbp(d.variance)} (extra)*`);
  else L.push(`🔴 *Variance −${gbp(Math.abs(d.variance))} (missing)*`);

  if (r.cash.length) {
    L.push("", LINE, "🔁 *MONEY IN / OUT*");
    for (const c of r.cash) {
      const note = [c.category, c.reason && c.reason !== c.category ? c.reason : null].filter(Boolean).join(" · ");
      L.push(`${c.direction === "out" ? "🔴 −" : "🟢 +"}${gbp(c.amount)} · ${METHOD_ICON[c.method] ?? ""} ${c.method}`);
      L.push(`     _${note}_ — ${c.by}`);
    }
  }

  const missing = r.missingDays.filter((x) => x !== r.date);
  if (missing.length || r.entered) L.push("");
  if (missing.length) L.push(`⚠️ *Day End missing:* ${missing.map(shortDay).join(", ")}`);
  if (r.entered) L.push(`✍️ Entered by ${r.entered.by}`);
  return L.join("\n");
}

/**
 * A WhatsApp link that opens a chat with this text (to `number`, or pick the
 * chat). Uses api.whatsapp.com/send, not the wa.me short link: wa.me's
 * redirect turns emojis into "�" (seen 2026-10-12 on the owner's WhatsApp).
 */
export function whatsAppUrl(text: string, number?: string | null): string {
  const n = (number ?? "").replace(/\D/g, "");
  return `https://api.whatsapp.com/send?${n ? `phone=${n}&` : ""}text=${encodeURIComponent(text)}`;
}
