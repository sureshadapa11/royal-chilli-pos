"use client";

import { useEffect, useState } from "react";
import CashBookMonth from "@/components/staff/CashBookMonth";
import SalaryMonth from "@/components/staff/SalaryMonth";
import type { BusinessMonth } from "@/lib/all-businesses-accounts";

// Daily accounts for the group owner with "Working in: All businesses" (like
// the INSOMNIA sheet's Summary): every business's month side by side, and any
// business's Cash book or Salary — each business keeps its own drawer.
type Row = BusinessMonth & { active: boolean; code: string | null };
const heading = { fontFamily: "var(--font-space-grotesk), var(--font-poppins), system-ui, sans-serif" } as const;
const gbp = (n: number | null) => (n == null ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export default function AllBusinessesAccounts({ startMonth, businesses }: { startMonth: string; businesses: { id: number; name: string; active: boolean }[] }) {
  const [month, setMonth] = useState(startMonth);
  const [view, setView] = useState<"summary" | "book" | "salary">("summary");
  const [biz, setBiz] = useState<number>(businesses.find((b) => b.active)?.id ?? businesses[0]?.id ?? 0);
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (view !== "summary") return;
    setRows(null);
    fetch(`/api/staff/all-accounts?month=${month}`).then((r) => (r.ok ? r.json() : null)).then((d) => setRows(d?.rows ?? [])).catch(() => setRows([]));
  }, [month, view]);

  const tab = (v: typeof view, label: string) => (
    <button type="button" onClick={() => setView(v)} aria-pressed={view === v}
      className={`rounded-lg px-4 py-1.5 text-[13.5px] font-semibold ${view === v ? "bg-[#E34435] text-white" : "text-[#5B524B] hover:bg-[#F6F1E6]"}`}>{label}</button>
  );
  const t = (f: (r: Row) => number | null) => Math.round((rows ?? []).reduce((s, r) => s + (f(r) ?? 0), 0) * 100) / 100;

  return (
    <div className="px-4 py-6 md:px-6 md:py-7">
      <div className="mx-auto max-w-[1300px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 style={heading} className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Daily accounts · All businesses</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every business side by side. Each one has its own cash drawer. Pick a business to see its own sheets.</p>
          </div>
          <div className="flex gap-1 rounded-xl bg-[#F6F1E6] p-1">{tab("summary", "Summary")}{tab("book", "Cash book")}{tab("salary", "Salary")}</div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" />
          {view !== "summary" && (
            <div className="flex flex-wrap gap-1">
              {businesses.map((b) => (
                <button key={b.id} onClick={() => setBiz(b.id)}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold ${biz === b.id ? "border-[#E34435] bg-red-50 text-[#E34435]" : "border-border bg-white"}`}>
                  {b.name}{!b.active && <span className="ml-1 text-[11px] font-normal text-muted-foreground">(not open)</span>}
                </button>
              ))}
            </div>
          )}
          <a href={`/api/staff/all-accounts/xlsx?month=${month}`} className="ml-auto rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold">Excel: all businesses</a>
        </div>

        <div className="mt-4">
          {view === "book" ? <CashBookMonth startMonth={month} month={month} businessId={biz} />
            : view === "salary" ? <SalaryMonth startMonth={month} month={month} businessId={biz} />
            : (
              <div className="overflow-x-auto rounded-xl border border-border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-[#F6F1E6] text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Business</th><th className="px-3 py-2 text-right">Total sales</th><th className="px-3 py-2 text-right">Ex-VAT</th>
                      <th className="px-3 py-2 text-right">Commission & card fees</th><th className="px-3 py-2 text-right">Money out</th><th className="px-3 py-2 text-right">Net total</th>
                      <th className="px-3 py-2 text-right">Cash variance</th><th className="px-3 py-2 text-right">Cash in drawer</th><th className="px-3 py-2 text-right">Day Ends</th><th className="px-3 py-2">Last Day End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!rows ? <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                      : rows.map((r) => (
                        <tr key={r.businessId} className={`border-t border-border tabular-nums ${r.active ? "" : "text-muted-foreground"}`}>
                          <td className="px-3 py-2 font-medium">{r.name}{!r.active && <span className="ml-1 text-[11px] font-normal">(not open)</span>}</td>
                          <td className="px-3 py-2 text-right font-semibold">{gbp(r.totalSales)}</td>
                          <td className="px-3 py-2 text-right">{gbp(r.exVat)}</td>
                          <td className="px-3 py-2 text-right">{gbp(r.commission)}</td>
                          <td className="px-3 py-2 text-right">{gbp(r.moneyOut)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${r.netTotal < 0 ? "text-red-700" : ""}`}>{gbp(r.netTotal)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${r.cashVariance == null ? "" : Math.abs(r.cashVariance) < 0.005 ? "text-emerald-700" : "text-red-700"}`}>
                            {r.cashVariance == null ? "—" : `${r.cashVariance > 0 ? "+" : ""}${gbp(r.cashVariance)}`}
                          </td>
                          <td className="px-3 py-2 text-right">{gbp(r.cashNow)}</td>
                          <td className="px-3 py-2 text-right">{r.dayEnds}{r.missing > 0 && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{r.missing} missing</span>}</td>
                          <td className="px-3 py-2">{r.lastDayEnd ? dayName(r.lastDayEnd) : "—"}</td>
                        </tr>
                      ))}
                    {rows && rows.length > 1 && (
                      <tr className="border-t-2 border-[#E8DFCB] bg-[#FBF8F1] font-semibold tabular-nums">
                        <td className="px-3 py-2">All businesses</td>
                        <td className="px-3 py-2 text-right">{gbp(t((r) => r.totalSales))}</td><td className="px-3 py-2 text-right">{gbp(t((r) => r.exVat))}</td>
                        <td className="px-3 py-2 text-right">{gbp(t((r) => r.commission))}</td><td className="px-3 py-2 text-right">{gbp(t((r) => r.moneyOut))}</td>
                        <td className="px-3 py-2 text-right">{gbp(t((r) => r.netTotal))}</td><td className="px-3 py-2 text-right">{gbp(t((r) => r.cashVariance))}</td>
                        <td className="px-3 py-2 text-right">{gbp(t((r) => r.cashNow))}</td><td className="px-3 py-2 text-right">{t((r) => r.dayEnds)}</td><td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
