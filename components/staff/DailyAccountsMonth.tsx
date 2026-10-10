"use client";

import { useCallback, useEffect, useState } from "react";
import { DAILY_FIELDS } from "@/lib/daily-accounts-fields";
import type { DailyRow } from "@/lib/daily-accounts";
import type { DayFigures, FiguresTotal } from "@/lib/daily-figures";

// Staff Hub → Daily accounts → Month: the paper Daily Accounts Report — every
// day of the month, each column, and the month total (each field added up on
// its own). Download as Excel (.xlsx) or print / save as PDF on A3 landscape.
// It starts with each day's Total sales, Ex-VAT, Money out and Net total and
// ends with Variance, worked out live by lib/daily-figures.ts.

type Month = {
  month: string; from: string; to: string; rows: DailyRow[]; totals: Record<string, number | null>;
  days: DayFigures[]; figuresTotal: FiguresTotal;
};

// The worked-out columns: four before the sheet's own, Variance after.
const LEAD: { key: "total_sales" | "ex_vat" | "money_out" | "net_total"; label: string }[] = [
  { key: "total_sales", label: "Total sales" },
  { key: "ex_vat", label: "Ex-VAT" },
  { key: "money_out", label: "Money out" },
  { key: "net_total", label: "Net total" },
];

const FORMULA = "Total sales = Z report (tips not included) + Just Eat + Deliveroo + Uber Eats + Hiest + catering paid · Ex-VAT = Total sales ÷ 1.2 · "
  + "Money out = stock received + expenses (VAT claimed back taken off) + card fee + till paid out + staff wages + commission · Net total = Ex-VAT − Money out · "
  + "Variance = opening balance − closing balance · * no Z report on the sheet yet, the till's figure is used";

const moneyOutTitle = (f: DayFigures) =>
  `Stock received £${f.out.stock.toFixed(2)}\nExpenses £${f.out.expenses.toFixed(2)}\nCard fee £${f.out.card_fee.toFixed(2)}\n`
  + `Till paid out £${f.out.paid_out.toFixed(2)}\nStaff wages £${f.out.wages.toFixed(2)}\nCommission £${f.out.commission.toFixed(2)}`;

const money = (v: unknown) => (v == null || v === "" ? "" : Number(v).toFixed(2));
const monthName = (m: string) => new Date(m + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; ) {
    out.push(d);
    const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10);
  }
  return out;
}

export default function DailyAccountsMonth({ startMonth, businessName, onOpenDay }: {
  startMonth: string; businessName: string; onOpenDay: (date: string) => void;
}) {
  const [month, setMonth] = useState(startMonth);
  const [data, setData] = useState<Month | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setData(null); setError("");
    const res = await fetch(`/api/staff/daily-accounts/month?month=${month}`);
    if (!res.ok) return setError("Couldn't load the month");
    setData(await res.json());
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const byDate = new Map((data?.rows ?? []).map((r) => [r.trading_date, r]));
  const figuresOf = new Map((data?.days ?? []).map((f) => [f.date, f]));
  const days = data ? daysOf(data.from, data.to) : [];

  // Excel: a real .xlsx from the server — dates as text (no #####), amounts as
  // numbers with 2 decimals, columns wide enough to read.
  function downloadExcel() {
    const a = document.createElement("a");
    a.href = `/api/staff/daily-accounts/month/xlsx?month=${month}`;
    a.click();
  }

  // Print / PDF: a clean A3-landscape sheet in its own window, so every column
  // fits on the page (printing the screen cut off whatever was scrolled away).
  function printSheet() {
    if (!data) return;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const head = `<tr><th class="l">Date</th>${LEAD.map((c) => `<th class="calc">${c.label}</th>`).join("")}${DAILY_FIELDS.map((f) => `<th>${esc(f.label)}</th>`).join("")}<th class="calc">Variance</th><th class="l notes">Notes</th></tr>`;
    const body = days.map((d) => {
      const r = byDate.get(d);
      const fig = figuresOf.get(d);
      const lead = LEAD.map((c) => `<td class="calc">${money(fig?.[c.key])}${c.key === "total_sales" && fig?.till_fallback ? "*" : ""}</td>`).join("");
      return `<tr${r?.status === "draft" ? ' class="draft"' : ""}><td class="l">${dayName(d)}</td>${lead}${DAILY_FIELDS.map((f) => `<td>${money(r?.[f.key])}</td>`).join("")}<td class="calc">${money(fig?.variance)}</td><td class="l notes">${esc(r?.notes ?? "")}</td></tr>`;
    }).join("");
    const ft = data.figuresTotal;
    const total = `<tr class="total"><td class="l">MONTH TOTAL</td>${LEAD.map((c) => `<td>${money(ft[c.key])}</td>`).join("")}${DAILY_FIELDS.map((f) => `<td>${money(data.totals[f.key])}</td>`).join("")}<td>${money(ft.variance)}</td><td></td></tr>`;
    const title = `${esc(businessName)} — Daily Accounts Report`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Daily accounts ${esc(businessName)} ${data.month}</title><style>
      @page { size: A3 landscape; margin: 8mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1C1917; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      h1 { font-size: 15px; margin: 0 0 2px; }
      p { font-size: 10px; margin: 0 0 6px; color: #57534E; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
      th, td { border: 1px solid #D8CFBD; padding: 3px 4px; text-align: right; font-variant-numeric: tabular-nums; overflow: hidden; }
      th { background: #1F4D3A; color: #fff; border-color: #1F4D3A; font-weight: 600; white-space: normal; }
      th.calc { background: #7A4E12; border-color: #7A4E12; }
      td.calc { background: #FBF3E4; }
      .l { text-align: left; }
      th.l:first-child, td.l:first-child { width: 74px; white-space: nowrap; }
      .notes { width: 150px; white-space: normal; word-break: break-word; }
      tr.draft td { background: #FFF8E1; }
      tr.total td { background: #EDE7DA; font-weight: 700; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    </style></head><body>
      <h1>${title}</h1>
      <p>Reporting month: ${monthName(data.month)} · amounts in £ · the total adds up each column on its own</p>
      <table><thead>${head}</thead><tbody>${body}${total}</tbody></table>
      <p style="margin-top:6px">${esc(FORMULA)}</p>
      <script>window.onload = function () { window.focus(); window.print(); };<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return window.print();
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  const cell = "border border-[#D8CFBD] px-1.5 py-1 text-right tabular-nums";
  const calcCell = `${cell} bg-[#FBF3E4]`;
  const calcHead = "border border-[#7A4E12] bg-[#7A4E12] px-1.5 py-1.5 font-semibold";
  return (
    <div className="da-sheet rounded-[14px] border border-border bg-surface p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-semibold">{businessName} — Daily Accounts Report</h2>
        <div className="da-noprint ml-auto flex flex-wrap items-center gap-2">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[14px]" />
          <button onClick={downloadExcel} disabled={!data} className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-surface-hover disabled:opacity-60">⬇ Excel</button>
          <button onClick={printSheet} disabled={!data} className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-surface-hover disabled:opacity-60">🖨 Print / PDF</button>
        </div>
      </div>
      <p className="mb-3 text-[12.5px] text-muted-foreground">Reporting month: {monthName(month)} · amounts in £ · the total adds up each column on its own</p>

      {error ? <p className="text-sm text-red-600">{error}</p> : !data ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1750px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#1F4D3A] text-white">
                <th className="border border-[#1F4D3A] px-1.5 py-1.5 text-left font-semibold">Date</th>
                {LEAD.map((c) => <th key={c.key} className={calcHead}>{c.label}</th>)}
                {DAILY_FIELDS.map((f) => <th key={f.key} className="border border-[#1F4D3A] px-1.5 py-1.5 font-semibold">{f.label}</th>)}
                <th className={calcHead}>Variance</th>
                <th className="border border-[#1F4D3A] px-1.5 py-1.5 text-left font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const r = byDate.get(d);
                const fig = figuresOf.get(d);
                return (
                  <tr key={d} onClick={() => onOpenDay(d)} title="Open this day"
                    className={`cursor-pointer hover:bg-[#FDF6E7] ${r?.status === "draft" ? "bg-[#FFF8E1]" : ""}`}>
                    <td className="whitespace-nowrap border border-[#D8CFBD] px-1.5 py-1 text-left">
                      {dayName(d)}{r?.status === "draft" && <span className="da-noprint ml-1 text-[10.5px] font-semibold text-amber-700">draft</span>}
                    </td>
                    {LEAD.map((c) => (
                      <td key={c.key} className={`${calcCell} ${c.key === "net_total" && (fig?.net_total ?? 0) < 0 ? "text-[#C0392B]" : ""}`}
                        title={c.key === "money_out" && fig ? moneyOutTitle(fig) : c.key === "total_sales" && fig?.till_fallback ? "No Z report on the sheet yet: the till's own figure is used" : undefined}>
                        {money(fig?.[c.key])}{c.key === "total_sales" && fig?.till_fallback && <span className="text-amber-700">*</span>}
                      </td>
                    ))}
                    {DAILY_FIELDS.map((f) => <td key={f.key} className={cell}>{money(r?.[f.key])}</td>)}
                    <td className={calcCell}>{money(fig?.variance)}</td>
                    <td className="max-w-[220px] truncate border border-[#D8CFBD] px-1.5 py-1 text-left" title={r?.notes ?? ""}>{r?.notes ?? ""}</td>
                  </tr>
                );
              })}
              <tr className="bg-[#EDE7DA] font-semibold">
                <td className="border border-[#D8CFBD] px-1.5 py-1.5 text-left">MONTH TOTAL</td>
                {LEAD.map((c) => <td key={c.key} className={`${cell} ${c.key === "net_total" && data.figuresTotal.net_total < 0 ? "text-[#C0392B]" : ""}`}>{money(data.figuresTotal[c.key])}</td>)}
                {DAILY_FIELDS.map((f) => <td key={f.key} className={cell}>{money(data.totals[f.key])}</td>)}
                <td className={cell}>{money(data.figuresTotal.variance)}</td>
                <td className="border border-[#D8CFBD]" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="da-noprint mt-2 text-[12px] text-muted-foreground">Tap a day to open it. Days in yellow are saved as drafts, not yet submitted. Point at a Money out figure to see what&apos;s in it.</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{FORMULA}</p>
    </div>
  );
}
