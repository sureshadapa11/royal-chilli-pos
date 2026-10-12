"use client";

import { useCallback, useEffect, useState } from "react";
import { tradingDayStr } from "@/lib/london-date";
import { PrintButton, PrintHeader } from "@/components/staff/PrintBits";

// Food cost & GP — what recipes say the food should have used vs what the
// stock counts say it did. Shown in Inventory → Reconciliation (where the
// stock takes are) and, read-only, in Finance → Food cost & GP.

function fmtMoney(n: number) { return `£${Number(n).toFixed(2)}`; }
type ReconciliationLine = { ingredient_id: number; ingredient_name: string; unit: string; theoretical_usage: number; actual_usage: number; variance_qty: number; variance_value: number };
type ReconciliationReport = { period: { from: string; to: string }; net_sales: number; cogs_theoretical: number; cogs_actual: number; gp_theoretical: number | null; gp_actual: number | null; gp_gap: number | null; lines: ReconciliationLine[] };

export default function FoodCostReport({ printTitle = "Food cost & GP" }: { printTitle?: string }) {
  const today = tradingDayStr();
  const weekAgo = tradingDayStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<ReconciliationReport | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/reports/reconciliation?from=${from}&to=${to}`);
    if (res.ok) setReport(await res.json());
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PrintHeader title={printTitle} from={from} to={to} />
      <div className="flex items-center gap-2 flex-wrap print:hidden">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <span className="text-muted-foreground">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <span className="ml-auto"><PrintButton disabled={!report} /></span>
      </div>

      {report && (
        <>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-3"><p className="text-muted-foreground text-xs">Net sales</p><p className="text-foreground font-bold text-lg">{fmtMoney(report.net_sales)}</p></div>
            <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-3"><p className="text-muted-foreground text-xs">GP % (theoretical)</p><p className="text-foreground font-bold text-lg">{report.gp_theoretical != null ? `${report.gp_theoretical}%` : "—"}</p></div>
            <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-3"><p className="text-muted-foreground text-xs">GP % (actual)</p><p className="text-foreground font-bold text-lg">{report.gp_actual != null ? `${report.gp_actual}%` : "—"}</p></div>
            <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-3"><p className="text-muted-foreground text-xs">GP gap</p><p className={`font-bold text-lg ${(report.gp_gap ?? 0) > 2 ? "text-red-600" : "text-foreground"}`}>{report.gp_gap != null ? `${report.gp_gap} pts` : "—"}</p></div>
          </div>
          <p className="mt-2 text-muted-foreground text-[11px]">Stock-vs-sales — only trustworthy once a stock take has been posted for this period, so the ledger already matches the shelf. Net sales are own orders ex-VAT after refunds; COGS (theoretical) matches Finance&apos;s recipe-based COGS. Delivery-platform orders aren&apos;t itemised, so their ingredients show as extra actual usage.</p>

          <div className="mt-4 rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Ingredient</th><th className="text-right px-3 py-2">Theoretical</th><th className="text-right px-3 py-2">Actual</th><th className="text-right px-3 py-2">Variance</th><th className="text-right px-3 py-2">Value</th></tr></thead>
              <tbody className="divide-y divide-border">
                {report.lines.map((l) => (
                  <tr key={l.ingredient_id} className="bg-background">
                    <td className="px-3 py-2 text-foreground font-medium">{l.ingredient_name}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{l.theoretical_usage.toFixed(2)} {l.unit}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{l.actual_usage.toFixed(2)} {l.unit}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${l.variance_qty > 0 ? "text-red-600" : l.variance_qty < 0 ? "text-emerald-600" : "text-muted-foreground"}`}>{l.variance_qty > 0 ? "+" : ""}{l.variance_qty.toFixed(2)} {l.unit}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${l.variance_value > 0 ? "text-red-600" : "text-foreground"}`}>{fmtMoney(l.variance_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.lines.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No usage recorded in this period.</p>}
          </div>
        </>
      )}
    </div>
  );
}
