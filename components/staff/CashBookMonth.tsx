"use client";

import { useEffect, useState } from "react";
import type { BookDay, SafeBook } from "@/lib/cash-book";

// Staff Hub → Daily accounts → Cash book: two books (136) — 🧾 Till (the
// drawer, day by day) and 🔒 Safe (cash that doesn't go through the till) —
// line by line with running balances (lib/cash-book.ts).
const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${n.toFixed(2)}`);
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export default function CashBookMonth({ startMonth, businessId, month: fixedMonth, sharedMonth }: { startMonth: string; businessId?: number; month?: string; sharedMonth?: string }) {
  const [ownMonth, setMonth] = useState(startMonth);
  const month = fixedMonth ?? sharedMonth ?? ownMonth;
  const [data, setData] = useState<{ start: string | null; days: BookDay[]; safe?: SafeBook } | null>(null);
  const [book, setBook] = useState<"till" | "safe">("till");
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
        {!sharedMonth && <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" />}
        <a href={`/api/staff/daily-accounts/month/xlsx?month=${month}`} className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold">Excel (with Cash book sheet)</a>
      </div>}
      <div className="flex gap-1 rounded-xl bg-[#F6F1E6] p-1 w-fit">
        {([["till", "🧾 Till"], ["safe", "🔒 Safe"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setBook(k)} className={`rounded-lg px-4 py-1.5 text-[13.5px] font-semibold ${book === k ? "bg-white text-foreground shadow-sm" : "text-[#5B524B]"}`}>{l}</button>
        ))}
      </div>
      {book === "safe" ? (data ? <SafeView safe={data.safe} /> : <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>) : (<>
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Cash in", gbp(totalIn), "text-emerald-700"], ["Cash out", gbp(totalOut), "text-red-700"],
            ["Variance (month)", `${variance > 0 ? "+" : ""}${gbp(variance)}`, Math.abs(variance) < 0.005 ? "text-emerald-700" : "text-red-700"],
            ["Cash in till now", gbp(last?.carry ?? null), "text-foreground"]].map(([l, v, c]) => (
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
      </>)}
    </div>
  );
}

// 🔒 Safe: every line in date order with the running balance, and any counts.
function SafeView({ safe }: { safe?: SafeBook }) {
  if (!safe || !safe.start) return <p className="rounded-xl border border-border bg-white px-4 py-6 text-center text-sm text-muted-foreground">Nothing in the Safe yet.</p>;
  const tiles: [string, string, string][] = [
    ["Brought forward", gbp(safe.opening), "text-foreground"], ["In this month", gbp(safe.totalIn), "text-emerald-700"],
    ["Out this month", gbp(safe.totalOut), "text-red-700"], ["Should be in the Safe", gbp(safe.balance), "text-foreground"],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([l, v, c]) => (
          <div key={l} className="rounded-xl border border-border bg-white px-3 py-2.5">
            <div className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{l}</div>
            <div className={`text-[18px] font-semibold tabular-nums ${c}`}>{v}</div>
          </div>
        ))}
      </div>
      {safe.lastCount && (
        <p className={`rounded-xl px-3 py-2 text-[13px] font-semibold ${Math.abs(safe.lastCount.difference) < 0.005 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          Last count {dayName(safe.lastCount.date)}: {gbp(safe.lastCount.counted)} · {Math.abs(safe.lastCount.difference) < 0.005 ? "matches ✓" : `${safe.lastCount.difference > 0 ? "+" : "−"}${gbp(Math.abs(safe.lastCount.difference))} ${safe.lastCount.difference > 0 ? "extra" : "missing"}`}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#F6F1E6] text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2">Person</th><th className="px-3 py-2 text-right">In</th><th className="px-3 py-2 text-right">Out</th><th className="px-3 py-2 text-right">Balance</th></tr>
          </thead>
          <tbody>
            {safe.opening !== 0 && (
              <tr className="border-t border-border"><td /><td className="px-3 py-1.5 font-semibold">Brought forward</td><td /><td /><td /><td className="px-3 py-1.5 text-right tabular-nums">{gbp(safe.opening)}</td></tr>
            )}
            {safe.lines.map((l, i) => (
              <tr key={i} className={`border-t ${l.kind === "count" ? "bg-[#FBF8F1]" : ""} ${i > 0 && safe.lines[i - 1].date !== l.date ? "border-[#E8DFCB] border-t-2" : "border-border"}`}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium">{i === 0 || safe.lines[i - 1].date !== l.date ? dayName(l.date) : ""}</td>
                <td className={`px-3 py-1.5 ${l.kind === "takings" ? "text-[#5B524B]" : ""}`}>
                  {l.kind === "count"
                    ? <>{l.label}: <b>{gbp(l.counted)}</b> <span className={Math.abs(l.difference ?? 0) < 0.005 ? "text-emerald-700" : "text-red-700"}>({Math.abs(l.difference ?? 0) < 0.005 ? "matches" : `${(l.difference ?? 0) > 0 ? "+" : "−"}${gbp(Math.abs(l.difference ?? 0))}`})</span></>
                    : l.label}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{l.by ?? ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{l.inAmount ? gbp(l.inAmount) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-red-700">{l.outAmount ? gbp(l.outAmount) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{gbp(l.balance)}</td>
              </tr>
            ))}
            {safe.lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nothing in or out of the Safe this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayRows({ d }: { d: BookDay }) {
  const off = d.variance != null && Math.abs(d.variance) >= 0.005;
  return (
    <>
      {d.lines.filter((l) => l.kind !== "bank").map((l, i) => (
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
          <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{gbp(d.counted ?? d.expected)}</td>
        </tr>
      )}
      {d.lines.filter((l) => l.kind === "bank").map((l, i) => (
        <tr key={`b${i}`} className="border-t border-border">
          <td /><td className="px-3 py-1.5">🔒 {l.label}</td><td className="px-3 py-1.5 text-muted-foreground">{l.by ?? ""}</td>
          <td /><td className="px-3 py-1.5 text-right tabular-nums text-red-700">{gbp(l.outAmount)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{gbp(l.balance)}</td>
        </tr>
      ))}
    </>
  );
}
