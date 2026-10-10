"use client";

import { useCallback, useEffect, useState } from "react";
import ZReportView from "@/components/pos/ZReportView";
import { zDateTime, type ZReport } from "@/lib/z-report";
import { firstOfMonthStr, tradingDayStr } from "@/lib/london-date";
import FoodCostReport from "@/components/staff/FoodCostReport";

function fmtMoney(n: number) { return `£${Number(n).toFixed(2)}`; }
function firstOfMonth() { return firstOfMonthStr(tradingDayStr()); }
function today() { return tradingDayStr(); }

function DateRangePicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const isToday = from === today() && to === today();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
      <span className="text-muted-foreground">to</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
      <button
        onClick={() => { setFrom(today()); setTo(today()); }}
        className={`px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${isToday ? "bg-red-600 border-red-500 text-white" : "bg-surface-hover border-border text-foreground hover:bg-elevated"}`}
      >
        Today
      </button>
    </div>
  );
}

// Same shape as lib/finance.ts Pnl — the admin dashboard summary reads the same numbers.
type Pnl = {
  vat_rate: number;
  sales: { till: number; platforms: number; catering: number; total: number; vat: number; ex_vat: number };
  costs: { ingredients: number; staff: number; expenses: number; commission: number; card_fees: number; paid_out: number; total: number };
  profit: number;
  vat: { output: number; vat_applicable_expenses: number; input: number; net_due: number };
  recipe: { cogs: number; coverage_pct: number; profit: number };
};

function usePnl(from: string, to: string, path: "pnl" | "vat") {
  const [data, setData] = useState<Pnl | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    fetch(`/api/finance/${path}?from=${from}&to=${to}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Failed to load"); return d; })
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) { setData(null); setError(e.message); } });
    return () => { live = false; };
  }, [from, to, path]);
  return { data, error };
}

const cardClass = "mt-4 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] divide-y divide-border";

function PnlTab() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const { data, error } = usePnl(from, to, "pnl");

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
      {data && (
        <>
          <div className={cardClass}>
            <Row label="Z report net sales (till, QR, website)" value={data.sales.till} />
            <Row label="Delivery platforms" value={data.sales.platforms} />
            {data.sales.catering > 0 && <Row label="Catering paid" value={data.sales.catering} />}
            <Row label="Total sales (incl. VAT)" value={data.sales.total} bold />
            <Row label="Less VAT on sales (÷ 1.2)" value={-data.sales.vat} />
            <Row label="Sales ex-VAT" value={data.sales.ex_vat} bold />
          </div>
          <div className={cardClass}>
            <Row label="Stock received (purchase orders)" value={-data.costs.ingredients} />
            <Row label="Staff (hours worked × pay rate)" value={-data.costs.staff} />
            <Row label="Other expenses (VAT claimed back taken off)" value={-data.costs.expenses} />
            <Row label="Delivery platform commission" value={-data.costs.commission} />
            <Row label="Card fees" value={-data.costs.card_fees} />
            <Row label="Cash paid out of the till" value={-data.costs.paid_out} />
            <Row label="Total costs" value={-data.costs.total} />
            <Row label="Net Profit" value={data.profit} bold />
          </div>
          <p className="mt-3 text-muted-foreground text-xs">
            Same figures as the dashboard, All businesses and the Daily accounts month sheet. Sales are the Z report&apos;s net sales (tips are staff&apos;s, not sales) plus delivery platforms and catering from Daily accounts.
            Stock is what was received on purchase orders in the period, not a stock valuation. Card fees use the rate in Settings → Business setup (1.69%).
          </p>

          <div className="mt-6 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4">
            <p className="text-foreground font-bold text-sm">Recipe-Based COGS (accrual)</p>
            <p className="text-muted-foreground text-xs mt-1">
              Same bottom line, but with the recipe cost of what was actually sold in place of what was bought.
            </p>
            <div className="mt-3 rounded-lg border border-border bg-surface divide-y divide-border">
              <Row label="Recipe-based COGS" value={-data.recipe.cogs} />
              <Row label="Net Profit (recipe basis)" value={data.recipe.profit} bold />
            </div>
            <p className="mt-2 text-xs font-semibold" style={{ color: data.recipe.coverage_pct >= 80 ? "#16a34a" : data.recipe.coverage_pct >= 30 ? "#d97706" : "#dc2626" }}>
              Recipes cover {data.recipe.coverage_pct}% of own-order item sales.
              {data.recipe.coverage_pct < 80 && " Add recipes in Inventory → Recipes & Food Cost for a fuller picture."}
              {data.sales.platforms > 0 && " Delivery-platform orders aren't itemised, so their food cost isn't included here."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const color = bold ? (value >= 0 ? "text-emerald-600" : "text-red-600") : "text-foreground";
  return (
    <div className="flex justify-between px-4 py-3">
      <span className={bold ? "text-foreground font-bold" : "text-muted-foreground"}>{label}</span>
      <span className={`${color} ${bold ? "font-bold" : ""}`}>{value < 0 ? "-" : ""}{fmtMoney(Math.abs(value))}</span>
    </div>
  );
}

function VatTab() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const { data, error } = usePnl(from, to, "vat");

  return (
    <div>
      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
      {data && (
        <div className={cardClass}>
          <Row label="Total sales (incl. VAT)" value={data.sales.total} />
          <Row label="Output VAT (Total sales ÷ 1.2 × 0.2)" value={data.vat.output} bold />
          <Row label="Expenses with VAT" value={data.vat.vat_applicable_expenses} />
          <Row label="Input VAT (reclaimable)" value={-data.vat.input} />
          <Row label="Net VAT Due" value={data.vat.net_due} bold />
        </div>
      )}
      <p className="mt-3 text-amber-600 text-xs">⚠ Estimate only — assumes every sale is standard-rated at 20%, raw ingredient purchases zero-rated, and no VAT reclaimed on platform commission. Verify with your accountant before filing.</p>
    </div>
  );
}

function ZReportsTab() {
  const [reports, setReports] = useState<{ id: number; opened_at: string; closed_at: string | null; close_note: string | null; net_sales: number | null; difference: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<ZReport | null>(null);
  const [status, setStatus] = useState<Record<number, string>>({});

  useEffect(() => {
    fetch("/api/work-periods/z-reports").then((r) => r.json()).then((d) => { setReports(d.reports || []); setLoading(false); });
  }, []);

  async function view(id: number) {
    const res = await fetch(`/api/work-periods/${id}/z-report`);
    if (res.ok) setViewing((await res.json()).report);
  }

  async function print(id: number) {
    setStatus((s) => ({ ...s, [id]: "Sending…" }));
    const res = await fetch(`/api/work-periods/${id}/z-report`, { method: "POST" }).catch(() => null);
    setStatus((s) => ({ ...s, [id]: res?.ok ? "Sent to printer ✓" : "Couldn't send" }));
  }

  return (
    <div className="space-y-2">
      {reports.map((p) => (
        <div key={p.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-foreground font-semibold">Z Report {p.id}<span className="ml-2 text-muted-foreground font-normal text-sm">{p.closed_at ? zDateTime(p.closed_at) : ""}</span></p>
            <p className="text-muted-foreground text-sm">
              Opened {zDateTime(p.opened_at)}
              {p.net_sales !== null && ` · Net sales ${fmtMoney(p.net_sales)}`}
              {p.difference !== null && p.difference !== 0 && ` · Cash ${p.difference > 0 ? "+" : ""}${fmtMoney(p.difference)}`}
              {p.close_note && ` · ${p.close_note}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status[p.id] && <span className="text-xs text-muted-foreground">{status[p.id]}</span>}
            <button onClick={() => view(p.id)} className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-surface-hover">View</button>
            <button onClick={() => print(p.id)} className="px-3 py-1.5 rounded-lg bg-red-500 text-sm font-semibold text-white hover:bg-red-600">Print</button>
          </div>
        </div>
      ))}
      {!loading && reports.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No closed till sessions yet.</p>}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setViewing(null)}>
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <ZReportView report={viewing} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => setViewing(null)} className="py-2.5 rounded-xl bg-surface-hover text-sm font-semibold text-foreground">Close</button>
              <button onClick={() => print(viewing.period_id)} className="py-2.5 rounded-xl bg-red-500 text-sm font-semibold text-white">{status[viewing.period_id] || "🖨️ Print"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One Excel file per month for the accountant (app/api/finance/export):
// daily trading-day summary, payments, refunds, Z reports and money out —
// plus a zip of the month's receipt photos, named as in the Money out sheet.
// The zip is built here in the browser from short-lived links: a month of
// photos is far bigger than a server response may be.
function AccountantExportTab() {
  const [month, setMonth] = useState(() => tradingDayStr().slice(0, 7));
  const [zipping, setZipping] = useState("");
  const [zipError, setZipError] = useState("");

  async function downloadReceipts() {
    setZipError("");
    setZipping("Preparing…");
    try {
      const res = await fetch(`/api/receipts/month?month=${month}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't get the photos");
      const files = data.files as { name: string; url: string }[];
      if (files.length === 0) { setZipError(`No receipt photos for ${month}.`); return; }
      const { zipSync } = await import("fflate");
      const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
      for (let i = 0; i < files.length; i++) {
        setZipping(`Downloading ${i + 1} of ${files.length}…`);
        const r = await fetch(files[i].url);
        if (!r.ok) throw new Error(`Couldn't download ${files[i].name}`);
        entries[files[i].name] = [new Uint8Array(await r.arrayBuffer()), { level: 0 }]; // photos are already compressed
      }
      const zip = zipSync(entries);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = `receipts-${month}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      if (data.missing > 0) setZipError(`${data.missing} older ${data.missing === 1 ? "entry has" : "entries have"} no photo (from before photos were required).`);
    } catch (e) {
      setZipError(e instanceof Error ? e.message : "Couldn't make the zip");
    } finally {
      setZipping("");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4 space-y-3">
      <p className="text-foreground font-semibold">Monthly accounts export (Excel)</p>
      <p className="text-muted-foreground text-sm">
        Sheets: Daily summary (trading days, 5am–5am: sales taken, card/cash/online, tips, refunds, VAT, discounts), Payments, Refunds, Z reports and Money out (expenses, supplier payments and deliveries, with their receipt photo names).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <a
          href={`/api/finance/export?month=${month}`}
          className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold"
        >
          ⬇ Download {month}
        </a>
        <button
          onClick={downloadReceipts}
          disabled={!!zipping}
          className="px-4 py-2 rounded-lg border border-border bg-surface hover:bg-surface-hover text-foreground text-sm font-semibold disabled:opacity-60"
        >
          {zipping || `📎 Receipt photos (.zip)`}
        </button>
      </div>
      {zipError && <p className="text-amber-700 text-xs">{zipError}</p>}
    </div>
  );
}

export default function FinanceView() {
  // Read-only: analysis and printing. Expenses and supplier payments are
  // recorded in Inventory.
  const [tab, setTab] = useState<"pnl" | "vat" | "foodcost" | "zreports" | "export">("pnl");
  const tabs = [
    { id: "pnl", label: "Profit & Loss" },
    { id: "vat", label: "VAT" },
    { id: "foodcost", label: "Food cost & GP" },
    { id: "zreports", label: "Z Reports" },
    { id: "export", label: "Accountant export" },
  ] as const;

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4 print:hidden">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">Finance</h1>
              <p className="text-muted-foreground text-sm">Read-only — profit, VAT, food cost and Z reports. Expenses and supplier payments are recorded in Inventory.</p>
            </div>
            <button onClick={() => window.print()} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-surface-hover print:hidden">🖨️ Print</button>
          </div>

          <div className="flex flex-wrap gap-1 mt-4 bg-surface-hover p-1 rounded-xl">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap ${tab === t.id ? "bg-red-500 text-white" : "text-muted-foreground"}`}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="hidden print:block text-lg font-bold">Finance — {tabs.find((t) => t.id === tab)?.label} · printed {new Date().toLocaleString("en-GB")}</h1>
        <div className="mt-5">
          {tab === "pnl" && <PnlTab />}
          {tab === "vat" && <VatTab />}
          {tab === "zreports" && <ZReportsTab />}
          {tab === "export" && <AccountantExportTab />}
          {tab === "foodcost" && <FoodCostReport />}
        </div>
      </div>
      </div>
    </>
  );
}
