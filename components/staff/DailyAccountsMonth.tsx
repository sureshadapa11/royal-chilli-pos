"use client";

import { useCallback, useEffect, useState } from "react";
import { DAILY_FIELDS } from "@/lib/daily-accounts-fields";
import type { DailyRow } from "@/lib/daily-accounts";

// Staff Hub → Daily accounts → Month: the paper Daily Accounts Report — every
// day of the month, each column, and the month total (each field added up on
// its own). Download for Excel (CSV) or print / save as PDF on A3 landscape.

type Month = { month: string; from: string; to: string; rows: DailyRow[]; totals: Record<string, number | null> };

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
  const days = data ? daysOf(data.from, data.to) : [];

  function downloadCsv() {
    if (!data) return;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = ["Date", ...DAILY_FIELDS.map((f) => f.label), "Notes", "Status"];
    const lines = days.map((d) => {
      const r = byDate.get(d);
      return [dayName(d), ...DAILY_FIELDS.map((f) => money(r?.[f.key])), r?.notes ?? "", r ? r.status : ""];
    });
    lines.push(["MONTH TOTAL", ...DAILY_FIELDS.map((f) => money(data.totals[f.key])), "", ""]);
    const csv = [head, ...lines].map((l) => l.map((v) => esc(String(v))).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Daily accounts ${businessName} ${data.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cell = "border border-[#D8CFBD] px-1.5 py-1 text-right tabular-nums";
  return (
    <div className="da-sheet rounded-[14px] border border-border bg-surface p-4 md:p-5">
      {/* Print / save as PDF: just the sheet, A3 landscape like the paper one. */}
      <style>{`@media print { @page { size: A3 landscape; margin: 10mm; } body * { visibility: hidden; } .da-sheet, .da-sheet * { visibility: visible; } .da-sheet { position: absolute; inset: 0; border: 0; } .da-noprint { display: none !important; } }`}</style>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-semibold">{businessName} — Daily Accounts Report</h2>
        <div className="da-noprint ml-auto flex flex-wrap items-center gap-2">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[14px]" />
          <button onClick={downloadCsv} disabled={!data} className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-surface-hover disabled:opacity-60">⬇ Excel (CSV)</button>
          <button onClick={() => window.print()} disabled={!data} className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-surface-hover disabled:opacity-60">🖨 Print / PDF</button>
        </div>
      </div>
      <p className="mb-3 text-[12.5px] text-muted-foreground">Reporting month: {monthName(month)} · amounts in £ · the total adds up each column on its own</p>

      {error ? <p className="text-sm text-red-600">{error}</p> : !data ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#1F4D3A] text-white">
                <th className="border border-[#1F4D3A] px-1.5 py-1.5 text-left font-semibold">Date</th>
                {DAILY_FIELDS.map((f) => <th key={f.key} className="border border-[#1F4D3A] px-1.5 py-1.5 font-semibold">{f.label}</th>)}
                <th className="border border-[#1F4D3A] px-1.5 py-1.5 text-left font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const r = byDate.get(d);
                return (
                  <tr key={d} onClick={() => onOpenDay(d)} title="Open this day"
                    className={`cursor-pointer hover:bg-[#FDF6E7] ${r?.status === "draft" ? "bg-[#FFF8E1]" : ""}`}>
                    <td className="whitespace-nowrap border border-[#D8CFBD] px-1.5 py-1 text-left">
                      {dayName(d)}{r?.status === "draft" && <span className="da-noprint ml-1 text-[10.5px] font-semibold text-amber-700">draft</span>}
                    </td>
                    {DAILY_FIELDS.map((f) => <td key={f.key} className={cell}>{money(r?.[f.key])}</td>)}
                    <td className="max-w-[220px] truncate border border-[#D8CFBD] px-1.5 py-1 text-left" title={r?.notes ?? ""}>{r?.notes ?? ""}</td>
                  </tr>
                );
              })}
              <tr className="bg-[#EDE7DA] font-semibold">
                <td className="border border-[#D8CFBD] px-1.5 py-1.5 text-left">MONTH TOTAL</td>
                {DAILY_FIELDS.map((f) => <td key={f.key} className={cell}>{money(data.totals[f.key])}</td>)}
                <td className="border border-[#D8CFBD]" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="da-noprint mt-2 text-[12px] text-muted-foreground">Tap a day to open it. Days in yellow are saved as drafts, not yet submitted.</p>
    </div>
  );
}
