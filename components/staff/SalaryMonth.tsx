"use client";

import { useEffect, useState } from "react";
import type { SalaryRow } from "@/lib/salary-sheet";
import { roleLabel } from "@/lib/roles";

// Staff Hub → Daily accounts → Salary (Super admin, HR, Supervisor): like the
// INSOMNIA sheet's Salary tab (lib/salary-sheet.ts).
const gbp = (n: number) => `£${n.toFixed(2)}`;
const hm = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };

export default function SalaryMonth({ startMonth }: { startMonth: string }) {
  const [month, setMonth] = useState(startMonth);
  const [rows, setRows] = useState<SalaryRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    fetch(`/api/staff/salary-sheet?month=${month}`).then((r) => (r.ok ? r.json() : null)).then((d) => setRows(d?.rows ?? [])).catch(() => setRows([]));
  }, [month]);
  const t = (f: (r: SalaryRow) => number) => Math.round((rows ?? []).reduce((s, r) => s + f(r), 0) * 100) / 100;
  const noRate = (rows ?? []).filter((r) => r.hours > 0 && r.payRate === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        <a href={`/api/staff/daily-accounts/month/xlsx?month=${month}`} className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold">Excel (with Salary sheet)</a>
      </div>
      {noRate.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">⚠ No pay rate yet for {noRate.map((r) => r.name).join(", ")}, so their wages show £0. Add it in HR → their details.</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#F6F1E6] text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Person</th><th className="px-3 py-2 text-right">Hours</th><th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Wages</th><th className="px-3 py-2 text-right">Paid (link)</th>
              <th className="px-3 py-2 text-right">Advance given</th><th className="px-3 py-2 text-right">Repaid</th><th className="px-3 py-2 text-right">Taken off pay</th>
              <th className="px-3 py-2 text-right">Advance owed</th><th className="px-3 py-2 text-right">Balance to pay</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Nobody to show for this month.</td></tr>
              : rows.map((r) => (
                <tr key={r.staffId} className="border-t border-border tabular-nums">
                  <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="text-[11.5px] text-muted-foreground">{roleLabel(r.role)}</div></td>
                  <td className="px-3 py-2 text-right">{hm(r.hours)}</td>
                  <td className="px-3 py-2 text-right">{r.payRate ? `${gbp(r.payRate)}/hr` : "—"}</td>
                  <td className="px-3 py-2 text-right">{gbp(r.wages)}</td>
                  <td className="px-3 py-2 text-right">{r.paid ? `−${gbp(r.paid)}` : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.advanceGiven ? gbp(r.advanceGiven) : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.advanceRepaid ? gbp(r.advanceRepaid) : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.advanceDeducted ? gbp(r.advanceDeducted) : "—"}</td>
                  <td className={`px-3 py-2 text-right ${r.advanceOwed ? "font-semibold text-amber-700" : ""}`}>{r.advanceOwed ? `−${gbp(r.advanceOwed)}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-bold">{gbp(r.balance)}</td>
                </tr>
              ))}
            {rows && rows.length > 0 && (
              <tr className="border-t-2 border-[#E8DFCB] bg-[#FBF8F1] font-semibold tabular-nums">
                <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{hm(t((r) => r.hours))}</td><td />
                <td className="px-3 py-2 text-right">{gbp(t((r) => r.wages))}</td><td className="px-3 py-2 text-right">{gbp(t((r) => r.paid))}</td>
                <td className="px-3 py-2 text-right">{gbp(t((r) => r.advanceGiven))}</td><td className="px-3 py-2 text-right">{gbp(t((r) => r.advanceRepaid))}</td>
                <td className="px-3 py-2 text-right">{gbp(t((r) => r.advanceDeducted))}</td><td className="px-3 py-2 text-right">{gbp(t((r) => r.advanceOwed))}</td>
                <td className="px-3 py-2 text-right">{gbp(t((r) => r.balance))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Wages = hours × pay rate. Balance to pay = wages − paid through the staff link − advance still owed.</p>
    </div>
  );
}
