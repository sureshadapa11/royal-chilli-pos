import { getOrderForPrint } from "@/lib/kot";
import { getBrand } from "@/lib/brand";
import { DEFAULT_BUSINESS_ID } from "@/lib/business-id";
import supabase from "@/lib/supabase";
import { getOrderForReceipt } from "@/lib/receipt";
import { paymentState } from "@/lib/payment-status";
import { roundNumberFor } from "@/lib/kitchen-rounds";
import { zReportLines } from "@/lib/z-report";
import { siteContent } from "@/lib/site-content";
import { getZReport } from "@/lib/z-report-db";
import QRCode from "qrcode";
import { claimUrl, paidAtFor, pointsForBill } from "@/lib/claim";

// Renders print_jobs rows (lib/print-queue.ts) into what the Star mC-Print3
// prints. A ticket is built once as styled lines, then encoded either as
// StarPRNT commands (bold, double size, auto-cut — what the printer is
// offered first) or as plain text (the fallback every CloudPRNT printer
// supports).

export type TicketLine = {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
  // "tall" = double height (same columns); "big" = double width + height (half the columns)
  size?: "normal" | "tall" | "big";
  // Extra-thick strokes (Z report section headings). The browser draws it
  // heavier; the printer's own font has no heavier weight, so it's bold there.
  thick?: boolean;
  // A QR code of this text (printed centred; `text` is the URL itself).
  // `qrSvg` is the same code pre-drawn for browser printing.
  qr?: boolean;
  qrSvg?: string;
};
export type Ticket = TicketLine[];

export type PrintJob = {
  id: number;
  order_id: number | null;
  work_period_id: number | null;
  kind: "kot" | "receipt" | "zreport";
  source: "till" | "qr" | "online" | null;
  item_ids: number[] | null;
};

// 80mm paper, Font A: 48 characters per line at normal width.
export const LINE_WIDTH = 48;

// Vercel runs in UTC — tickets must show restaurant-local time.
function londonTime(iso: string, withDate = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(withDate ? { day: "2-digit", month: "2-digit", year: "numeric" } : {}),
  }).format(new Date(iso));
}

function money(n: number): string {
  return `£${Number(n).toFixed(2)}`;
}

// Left text + right-aligned amount, `width` columns wide. When the text is
// too long to share a line with the amount, the amount drops to the next
// line (split into separate ticket lines by buildTicket) rather than cutting
// the text short.
function rowAt(width: number, left: string, right: string): string {
  if (left.length + 1 + right.length > width) return `${left}\n${right.padStart(width)}`;
  return left + " ".repeat(width - left.length - right.length) + right;
}

// Fit `text` into lines of at most `width`, breaking between words (never
// mid-word unless one word is longer than the line). Continuation lines keep
// the original indent, so "   ** no onions please…" stays lined up.
export function wrapWords(text: string, width: number): string[] {
  if (text.length <= width || width < 8) return [text];
  const indent = text.match(/^\s*/)![0];
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = indent;
  for (const w of words) {
    const room = width - cur.length - (cur.trim() ? 1 : 0);
    if (w.length <= room) {
      cur = cur.trim() ? `${cur} ${w}` : `${cur}${w}`;
      continue;
    }
    if (cur.trim()) lines.push(cur);
    let rest = w;
    while (indent.length + rest.length > width) {
      // a single word longer than the line — split it, nothing else fits
      lines.push(indent + rest.slice(0, width - indent.length));
      rest = rest.slice(width - indent.length);
    }
    cur = indent + rest;
  }
  if (cur.trim()) lines.push(cur);
  return lines;
}

// A line holding "\n" (a wrapped row) becomes separate lines, same style, and
// anything still too long wraps between words. "big" text is double width,
// so it gets half the columns. QR lines are left alone.
function splitLines(ticket: Ticket, width: number): Ticket {
  return ticket.flatMap((l) =>
    l.qr
      ? [l]
      : l.text
          .split("\n")
          .flatMap((text) => wrapWords(text, l.size === "big" ? Math.floor(width / 2) : width).map((t) => ({ ...l, text: t }))),
  );
}

// Each builder lays out for a given line width: the printer's own 48, or
// fewer (bigger text) for the browser-print fallback.
function layout(width: number) {
  return { row: (left: string, right: string) => rowAt(width, left, right), DIVIDER: "-".repeat(width) };
}

const SOURCE_LABEL: Record<string, string> = { till: "TILL", qr: "QR ORDER", online: "ONLINE" };

export async function buildTicket(job: PrintJob, width = LINE_WIDTH): Promise<Ticket | null> {
  let ticket: Ticket | null = null;
  if (job.kind === "zreport") ticket = job.work_period_id ? await buildZReportTicket(job.work_period_id, width) : null;
  else if (job.order_id) ticket = job.kind === "receipt" ? await buildReceipt(job.order_id, width) : await buildKitchenTicket(job, job.order_id, width);
  return ticket && splitLines(ticket, width);
}

// "43 Kingsley Road, Hounslow, London, TW3 1PA" as lines of at most `width`,
// breaking after commas.
export function addressLines(address: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const part of address.split(",").map((p) => p.trim()).filter(Boolean)) {
    const next = current ? `${current}, ${part}` : part;
    if (next.length > width && current) {
      lines.push(`${current},`);
      current = part;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

async function buildZReportTicket(workPeriodId: number, width: number): Promise<Ticket | null> {
  const { row, DIVIDER } = layout(width);
  const report = await getZReport(workPeriodId);
  if (!report) return null;
  const { data: period } = await supabase.from("work_periods").select("business_id").eq("id", workPeriodId).single();
  const brand = await getBrand(period?.business_id ?? DEFAULT_BUSINESS_ID);
  const t: Ticket = [];
  t.push({ text: brand.name.toUpperCase(), align: "center", bold: true, size: "big" });
  // Full address under the name, split to fit a narrow line.
  for (const part of addressLines(brand.fullAddress, width)) t.push({ text: part, align: "center" });
  if (brand.phone) t.push({ text: brand.phone, align: "center" });
  t.push({ text: DIVIDER });
  for (const l of zReportLines(report)) {
    if (l.kind === "title") t.push({ text: l.text, bold: true, size: "tall" });
    // Section headings: extra-thick, so each section reads as a title.
    else if (l.kind === "heading") t.push({ text: l.text, bold: true, thick: true });
    // The key figures (Total net sales, Difference) print tall.
    else if (l.kind === "row") t.push({ text: row(l.label, l.value), bold: l.bold, size: l.bold ? "tall" : undefined });
    else if (l.kind === "text") t.push({ text: l.text });
    else if (l.kind === "divider") t.push({ text: DIVIDER });
    else t.push({ text: "" });
  }
  t.push({ text: DIVIDER });
  t.push({ text: `Printed ${londonTime(new Date().toISOString(), true)}`, align: "center" });
  return t;
}

async function buildKitchenTicket(job: PrintJob, orderId: number, width: number): Promise<Ticket | null> {
  const { row, DIVIDER } = layout(width);
  const data = await getOrderForPrint(orderId);
  // A cancelled order (e.g. a scheduled one cancelled before its print time)
  // must not reach the kitchen.
  if (!data || data.order.status === "cancelled") return null;
  const { order } = data;

  const items = job.item_ids ? data.items.filter((i) => job.item_ids!.includes(i.id)) : data.items;
  if (items.length === 0) return null;
  const isAddOn = job.item_ids !== null && data.items.length > items.length;

  const t: Ticket = [];
  t.push({ text: `*** ${job.source ? SOURCE_LABEL[job.source] : "REPRINT"} ***`, align: "center", bold: true, size: "big" });
  if (order.order_type === "dine_in") {
    t.push({ text: order.table_number ? `TABLE ${plainTableLabel(order.table_number)}` : "DINE-IN", align: "center", bold: true, size: "big" });
  } else {
    t.push({ text: order.order_type === "delivery" ? "DELIVERY" : "COLLECTION", align: "center", bold: true, size: "big" });
  }
  if (isAddOn) t.push({ text: "+ ADDITIONAL ITEMS +", align: "center", bold: true, size: "tall" });
  // A table's 2nd, 3rd… till round: same table, only the new items (the
  // Kitchen Display adds them to that table's box as the next round).
  const round = !isAddOn && order.order_type === "dine_in" && order.table_id ? await roundNumberFor({ id: orderId, table_id: Number(order.table_id) }).catch(() => null) : null;
  if (round && round > 1) t.push({ text: `ROUND ${round} - ADDED ITEMS`, align: "center", bold: true, size: "tall" });
  if (order.scheduled_for) {
    t.push({ text: `FOR ${londonTime(order.scheduled_for)}`, align: "center", bold: true, size: "big" });
    t.push({ text: londonTime(order.scheduled_for, true), align: "center" });
  }
  t.push({ text: row(`Order ${order.order_number}`, londonTime(order.created_at, true)) });
  if (order.customer_name) t.push({ text: `Customer: ${order.customer_name}` });
  if (order.order_type !== "dine_in" && order.customer_phone) t.push({ text: `Phone: ${order.customer_phone}` });
  if (order.order_type === "delivery" && order.customer_address) {
    t.push({ text: `Address: ${order.customer_address}${order.customer_postcode ? `, ${order.customer_postcode}` : ""}` });
  }
  t.push({ text: DIVIDER });

  for (const item of items) {
    t.push({ text: `${item.quantity}x ${item.item_name}`, bold: true, size: "tall" });
    if (item.modifiers.length > 0) t.push({ text: `   - ${item.modifiers.join(", ")}` });
    if (item.notes) t.push({ text: `   *** ${item.notes.toUpperCase()} ***`, bold: true });
    // Only when the dish has allergens — no space used otherwise.
    if (item.allergens?.length) t.push({ text: `   ALLERGENS: ${item.allergens.join(", ").toUpperCase()}`, bold: true });
  }
  t.push({ text: DIVIDER });

  if (order.notes) {
    t.push({ text: `NOTE: ${order.notes}`, bold: true });
    t.push({ text: DIVIDER });
  }

  if (job.source === "online") {
    const due = Number(order.total) - Number(order.amount_paid);
    t.push(
      due <= 0.01
        ? { text: "PAID ONLINE", align: "center", bold: true, size: "tall" }
        : { text: `TO PAY: ${money(due)}`, align: "center", bold: true, size: "tall" }
    );
  }
  t.push({ text: `Printed ${londonTime(new Date().toISOString())}`, align: "center" });
  return t;
}

/** A setup text box as printed lines (blank lines dropped). */
const lines = (text: string | null) => (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", card_online: "Online" };

async function buildReceipt(orderId: number, width: number): Promise<Ticket | null> {
  const { row, DIVIDER } = layout(width);
  const data = await getOrderForReceipt(orderId);
  if (!data) return null;
  const { order, items, payments } = data;

  // A refund leaves nothing owed, so a refunded order never shows a balance.
  const refunded = payments.reduce((s, p) => s + (Number(p.amount) < 0 ? -Number(p.amount) : 0), 0);
  const state = paymentState(order, refunded);
  const balanceDue = state === "unpaid" || state === "part_paid" ? Math.round((Number(order.total) - Number(order.amount_paid)) * 100) / 100 : 0;
  const statusLine = { paid: "PAID", part_paid: "BALANCE DUE", unpaid: "UNPAID", refunded: "REFUNDED", part_refunded: "PART REFUNDED" }[state];
  const place = order.order_type === "dine_in"
    ? (order.table_number ? `TABLE ${plainTableLabel(order.table_number)}` : "DINE-IN")
    : String(order.order_type).toUpperCase();

  const brand = await getBrand(order.business_id ?? DEFAULT_BUSINESS_ID);
  const t: Ticket = [];
  t.push({ text: brand.name.toUpperCase(), align: "center", bold: true, size: "big" });
  if (brand.address) t.push({ text: brand.address, align: "center" });
  if (brand.phone) t.push({ text: brand.phone, align: "center" });
  // Business setup → Receipts & numbering / Tax & VAT.
  for (const line of lines(brand.receiptHeader)) t.push({ text: line, align: "center" });
  if (brand.vatNumber) t.push({ text: `VAT No. ${brand.vatNumber}`, align: "center" });
  t.push({ text: DIVIDER });
  t.push({ text: "RECEIPT", align: "center", bold: true });
  t.push({ text: statusLine, align: "center", bold: true });
  t.push({ text: DIVIDER });
  t.push({ text: place, bold: true, size: "tall" });
  t.push({ text: row(`Order ${order.order_number}`, londonTime(order.created_at, true)) });
  if (order.staff_name) t.push({ text: `Served by: ${order.staff_name}` });
  if (order.customer_name) t.push({ text: `Customer: ${order.customer_name}` });
  t.push({ text: DIVIDER });

  for (const item of items) {
    t.push({ text: row(`${item.quantity}x ${item.item_name}`, money(Number(item.item_price) * item.quantity)) });
    for (const m of item.modifiers) {
      t.push({ text: m.price_delta !== 0 ? row(`   - ${m.option_name}`, `${m.price_delta > 0 ? "+" : ""}${money(m.price_delta)}`) : `   - ${m.option_name}` });
    }
    if (item.notes) t.push({ text: `   ** ${item.notes}` });
  }
  t.push({ text: DIVIDER });

  // Subtotal → service charge → tip → discount → loyalty → TOTAL (what they
  // paid, tip included). VAT is on the food only — not service charge or tip.
  const tips = payments.reduce((s, p) => s + (Number(p.amount) > 0 ? Number(p.tip_amount || 0) : 0), 0);
  t.push({ text: row("Subtotal", money(order.subtotal)) });
  if (Number(order.service_charge_amount) > 0) t.push({ text: row("Service Charge", money(order.service_charge_amount)) });
  if (tips > 0) t.push({ text: row("Tip", money(tips)) });
  if (Number(order.discount) > 0) {
    t.push({ text: row(`Discount${order.discount_reason ? ` (${order.discount_reason})` : ""}`, `-${money(order.discount)}`) });
  }
  if (Number(order.loyalty_discount) > 0) {
    t.push({ text: row(order.loyalty_reason || "Loyalty", `-${money(order.loyalty_discount)}`) });
  }
  t.push({ text: row("TOTAL", money(Number(order.total) + tips)), bold: true, size: "tall" });
  t.push({ text: row("incl. VAT", money(order.tax)) });
  t.push({ text: DIVIDER });

  if (payments.length > 0) {
    t.push({ text: "PAYMENTS", bold: true });
    for (const p of payments) {
      const refund = Number(p.amount) < 0;
      t.push({ text: row(`${refund ? "Refund - " : ""}${METHOD_LABEL[p.method] ?? p.method}`, money(Number(p.amount) + (refund ? 0 : Number(p.tip_amount || 0)))) });
    }
  }
  if (refunded > 0.009) t.push({ text: row("Total Refunded", money(refunded)), bold: true });
  if (balanceDue > 0.01) t.push({ text: row("Balance Due", money(balanceDue)), bold: true });
  t.push({ text: DIVIDER });

  // No member on a paid dine-in bill: invite them to claim its points.
  if (order.order_type === "dine_in" && !order.customer_id && state === "paid") {
    const points = await pointsForBill(order.business_id ?? DEFAULT_BUSINESS_ID, Number(order.total), await paidAtFor(orderId));
    if (points > 0) {
      const url = claimUrl(orderId);
      t.push({ text: "JOIN OUR REWARDS CLUB", align: "center", bold: true });
      t.push({ text: `Scan to claim ${points} points`, align: "center", bold: true });
      t.push({ text: "for this visit", align: "center" });
      t.push({ text: url, align: "center", qr: true, qrSvg: await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).catch(() => undefined) });
      t.push({ text: "+200 bonus points & 20% off", align: "center" });
      t.push({ text: "your next dine-in visit", align: "center" });
      t.push({ text: "Claim within 7 days", align: "center" });
      t.push({ text: DIVIDER });
    }
  }
  for (const line of lines(brand.receiptFooter)) t.push({ text: line, align: "center" });
  t.push({ text: `Printed ${londonTime(new Date().toISOString(), true)}`, align: "center" });
  return t;
}

// ---------- encoders ----------

export function toPlainText(ticket: Ticket): string {
  const lines = ticket.map((l) => {
    const width = l.size === "big" ? LINE_WIDTH / 2 : LINE_WIDTH;
    if (l.align !== "center" || l.text.length >= width) return l.text;
    return " ".repeat(Math.floor((LINE_WIDTH - l.text.length) / 2)) + l.text;
  });
  return [...lines, "", "", ""].join("\n");
}

// The printer only has single-byte code pages, so text goes out as CP437:
// "£" has its own byte there; accents are stripped and anything else
// non-ASCII (smart quotes, dashes, emoji from a customer's note) is swapped
// for a plain equivalent rather than printing as garbage.
const CP437_EXTRA: Record<string, number> = { "£": 0x9c, "·": 0xfa };
const ASCII_SWAPS: Record<string, string> = { "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "✓": "*" };

/** A joined-table label ("T1 + T2 · 🎂 Birthday party") without its emoji,
 *  which would print as "?" in the big table line. */
export const plainTableLabel = (label: string) =>
  label.replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, "").replace(/\s+/g, " ").trim();

export function encodeCp437(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFD").replace(/[̀-ͯ]/g, "")) {
    if (CP437_EXTRA[ch] !== undefined) out.push(CP437_EXTRA[ch]);
    else if (ASCII_SWAPS[ch]) out.push(...[...ASCII_SWAPS[ch]].map((c) => c.charCodeAt(0)));
    else {
      const code = ch.charCodeAt(0);
      out.push(code >= 0x20 && code < 0x7f ? code : 0x3f); // "?"
    }
  }
  return out;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// StarPRNT command set (the mC-Print3's native emulation).
export function toStarPrnt(ticket: Ticket): Uint8Array {
  const out: number[] = [
    ESC, 0x40, // initialise
    ESC, GS, 0x74, 1, // code page 437
  ];
  for (const l of ticket) {
    out.push(ESC, GS, 0x61, l.align === "center" ? 1 : 0);
    if (l.qr) {
      // StarPRNT QR: model 2, error correction M, cell size 6, data, print
      const data = encodeCp437(l.text);
      out.push(ESC, GS, 0x79, 0x53, 0x30, 2);
      out.push(ESC, GS, 0x79, 0x53, 0x31, 1);
      out.push(ESC, GS, 0x79, 0x53, 0x32, 6);
      out.push(ESC, GS, 0x79, 0x44, 0x31, 0, data.length & 0xff, (data.length >> 8) & 0xff, ...data);
      out.push(ESC, GS, 0x79, 0x50, LF);
      continue;
    }
    if (l.bold) out.push(ESC, 0x45);
    if (l.size === "big") out.push(ESC, 0x69, 1, 1);
    else if (l.size === "tall") out.push(ESC, 0x69, 1, 0);
    out.push(...encodeCp437(l.text), LF);
    if (l.size === "big" || l.size === "tall") out.push(ESC, 0x69, 0, 0);
    if (l.bold) out.push(ESC, 0x46);
  }
  out.push(ESC, GS, 0x61, 0);
  out.push(ESC, 0x64, 3); // feed to cutter + partial cut
  return Uint8Array.from(out);
}
