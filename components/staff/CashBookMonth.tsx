"use client";

import { useEffect, useState } from "react";
import type { BookDay } from "@/lib/cash-book";

// Staff Hub → Daily accounts → Cash book: this business's cash drawer, day by
// day and line by line, with a running balance (lib/cash-book.ts).
const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${n.toFixed(2)}`);
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export default function CashBookMonth({ startMonth, businessId, month: fixedMonth }: { startMonth: string; businessId?: number; month?: string }) {
  const [ownMonth, setMonth] = useState(startMonth);
  const month = fixedMonth ?? ownMonth;
  const [data, setData] = useState<{ start: string | null; days: BookDay[] } | null>(null);
  useEffect(() => {
    setData(null);
    fetch(`/api/staff/cash-book?month=${month}${businessId ? `&business=${businessId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, [month, businessId]);

  const days = data?.days ?? [];
  const sum = (f: (d: BookDay) => number) => Math.round(days.reduce((s, d) => s + f(d), 0) * 100) / 100;
  const totalIn = sum((d) => d.lines.reduce((s, l) => s + l.inAmount, 0));
  const totalOut = sum((d) => d.lines.reduce((s, l) => s + l.outAmount, 0));
  const variance = sum((d) => d.variance ?? 0);
  const last = [...days].reverse().find((d) => d.carry != null);

  return (
    <div className="space-y-4">
      {!fixedMonth && <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        <a href={`/api/staff/daily-accounts/month/xlsx?month=${month}`} className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold">Excel (with Cash book sheet)</a>
      </div>}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Cash in", gbp(totalIn), "text-emerald-700"], ["Cash out", gbp(totalOut), "text-red-700"],
            ["Variance (month)", `${variance > 0 ? "+" : ""}${gbp(variance)}`, Math.abs(variance) < 0.005 ? "text-emerald-700" : "text-red-700"],
            ["Cash in drawer now", gbp(last?.carry ?? null), "text-foreground"]].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-border bg-white px-3 py-2.5">
              <div className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{l}</div>
              <div className={`text-[18px] font-semibold tabular-nums ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {!data ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        : !data.start ? <p className="rounded-xl border border-border bg-white px-4 py-6 text-center text-sm text-muted-foreground">The cash book starts from the first Day End with an opening cash figure. None yet.</p>
        : days.length === 0 ? <p className="rounded-xl border border-border bg-white px-4 py-6 text-center text-sm text-muted-foreground">Nothing in this month. The cash book starts on {dayName(data.start)}.</p>
        : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[#F6F1E6] text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2">Person</th><th className="px-3 py-2 text-right">In</th><th className="px-3 py-2 text-right">Out</th><th className="px-3 py-2 text-right">Balance</th></tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <DayRows key={d.date} d={d} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="text-xs text-muted-foreground">Cash only: card and bank transfer entries don&apos;t touch the drawer. Variance = counted − expected (minus = missing).</p>
    </div>
  );
}

function DayRows({ d }: { d: BookDay }) {
  const off = d.variance != null && Math.abs(d.variance) >= 0.005;
  return (
    <>
      {d.lines.map((l, i) => (
        <tr key={i} className={i === 0 ? "border-t-2 border-[#E8DFCB]" : "border-t border-border"}>
          <td className="whitespace-nowrap px-3 py-1.5 font-medium">{i === 0 ? dayName(d.date) : ""}</td>
          <td className={`px-3 py-1.5 ${l.kind === "opening" ? "font-semibold" : ""}`}>
            {l.label}
            {l.kind === "opening" && d.openingDiff != null && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">⚠ {d.openingDiff > 0 ? "+" : ""}£{d.openingDiff.toFixed(2)} vs last count</span>
            )}
          </td>
          <td className="px-3 py-1.5 text-muted-foreground">{l.by ?? ""}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{l.inAmount ? gbp(l.inAmount) : ""}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-red-700">{l.outAmount ? gbp(l.outAmount) : ""}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{gbp(l.balance)}</td>
        </tr>
      ))}
      {!d.entered && (
        <tr className="border-t border-border"><td className="px-3 py-1.5 font-medium">{d.lines.length ? "" : dayName(d.date)}</td><td colSpan={5} className="px-3 py-1.5 text-amber-700">⚠ No Day End for this day</td></tr>
      )}
      {d.expected != null && (
        <tr className="border-t border-border bg-[#FBF8F1] text-[13px]">
          <td />
          <td className="px-3 py-1.5" colSpan={2}>Expected {gbp(d.expected)} · Counted {gbp(d.counted)}</td>
          <td colSpan={2} className={`px-3 py-1.5 text-right font-semibold ${d.variance == null ? "" : off ? "text-red-700" : "text-emerald-700"}`}>
            {d.variance == null ? "Not counted" : `Variance ${d.variance > 0 ? "+" : ""}${gbp(d.variance)}`}
          </td>
          <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{gbp(d.carry)}</td>
        </tr>
      )}
    </>
  );
}
