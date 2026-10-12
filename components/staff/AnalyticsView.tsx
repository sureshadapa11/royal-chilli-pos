"use client";

import { useCallback, useEffect, useState } from "react";
import { firstOfMonthStr, tradingDayStr } from "@/lib/london-date";
import { PrintButton, PrintHeader } from "@/components/staff/PrintBits";

function fmtMoney(n: number) { return `£${Number(n).toFixed(2)}`; }
function firstOfMonth() { return firstOfMonthStr(tradingDayStr()); }
function today() { return tradingDayStr(); }

type SalesData = {
  total_revenue: number; refunds_total: number; total_orders: number; avg_order_value: number;
  hourly: { hour: number; orders: number; revenue: number }[];
  peak_hour: { hour: number; orders: number; revenue: number } | null;
  daily: { date: string; orders: number; revenue: number }[];
};
type MenuItemStat = { item_name: string; quantity_sold: number; revenue: number; margin_pct: number | null };
type WasteStat = { ingredient_id: number; name: string; unit: string; quantity: number; value: number };
type ForecastStat = { ingredient_id: number; name: string; unit: string; current_stock: number; daily_consumption: number; days_until_reorder: number | null };

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-4">
      <p className="text-muted-foreground text-xs uppercase tracking-widest">{label}</p>
      <p className="text-foreground text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function SalesTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<SalesData | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/analytics/sales?from=${from}&to=${to}`).then((r) => r.json()).then(setData);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [from, to]);
  if (!data) return null;

  const maxHourly = Math.max(...data.hourly.map((h) => h.orders), 1);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Revenue" value={fmtMoney(data.total_revenue)} />
        <StatCard label="Orders" value={String(data.total_orders)} />
        <StatCard label="Avg Order Value" value={fmtMoney(data.avg_order_value)} />
        <StatCard label="Peak Hour" value={data.peak_hour ? `${data.peak_hour.hour}:00` : "—"} />
      </div>
      {data.refunds_total > 0 && (
        <p className="text-muted-foreground text-xs mt-2">Revenue above is net of {fmtMoney(data.refunds_total)} in refunds this period.</p>
      )}

      <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest mt-6 mb-2">Orders by Hour</h3>
      <div className="space-y-1">
        {data.hourly.map((h) => (
          <div key={h.hour} className="flex items-center gap-2 text-sm">
            <span className="w-10 text-muted-foreground">{h.hour}:00</span>
            <div className="flex-1 bg-surface-hover rounded h-4 overflow-hidden">
              <div className="h-full bg-red-600" style={{ width: `${(h.orders / maxHourly) * 100}%` }} />
            </div>
            <span className="w-8 text-right text-muted-foreground">{h.orders}</span>
          </div>
        ))}
        {data.hourly.length === 0 && <p className="text-muted-foreground text-sm">No sales in this period.</p>}
      </div>
    </div>
  );
}

function MenuTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<{ best_sellers: MenuItemStat[]; worst_sellers: MenuItemStat[] } | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/analytics/menu?from=${from}&to=${to}`).then((r) => r.json()).then(setData);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [from, to]);
  if (!data) return null;

  const List = ({ items, title }: { items: MenuItemStat[]; title: string }) => (
    <div>
      <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-2">{title}</h3>
      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Qty</th><th className="text-right px-3 py-2">Revenue</th><th className="text-right px-3 py-2">Margin</th></tr></thead>
          <tbody className="divide-y divide-border">
            {items.map((i) => (
              <tr key={i.item_name} className="bg-background">
                <td className="px-3 py-2 text-foreground">{i.item_name}</td>
                <td className="px-3 py-2 text-right text-foreground">{i.quantity_sold}</td>
                <td className="px-3 py-2 text-right text-foreground">{fmtMoney(i.revenue)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${i.margin_pct === null ? "text-muted-foreground" : i.margin_pct >= 65 ? "text-emerald-600" : "text-amber-600"}`}>
                  {i.margin_pct === null ? "—" : `${i.margin_pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No data.</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <List items={data.best_sellers} title="Best Sellers" />
      <List items={data.worst_sellers} title="Worst Sellers" />
      <p className="text-muted-foreground text-xs">Margin only shows for items with a recipe costed in Inventory → Recipes.</p>
    </div>
  );
}

function InventoryTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<{ waste: WasteStat[]; total_waste_value: number; forecast: ForecastStat[] } | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/analytics/inventory?from=${from}&to=${to}`).then((r) => r.json()).then(setData);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [from, to]);
  if (!data) return null;

  return (
    <div className="space-y-6">
      <StatCard label="Total Waste Value" value={fmtMoney(data.total_waste_value)} />

      <div>
        <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-2">Waste by Ingredient</h3>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Ingredient</th><th className="text-right px-3 py-2">Quantity</th><th className="text-right px-3 py-2">Value</th></tr></thead>
            <tbody className="divide-y divide-border">
              {data.waste.map((w) => (
                <tr key={w.ingredient_id} className="bg-background">
                  <td className="px-3 py-2 text-foreground">{w.name}</td>
                  <td className="px-3 py-2 text-right text-foreground">{w.quantity} {w.unit}</td>
                  <td className="px-3 py-2 text-right text-red-600">{fmtMoney(w.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.waste.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No waste recorded in this period.</p>}
        </div>
      </div>

      <div>
        <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-2">Stock Forecast</h3>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-muted-foreground"><tr><th className="text-left px-3 py-2">Ingredient</th><th className="text-right px-3 py-2">Stock</th><th className="text-right px-3 py-2">Daily Use</th><th className="text-right px-3 py-2">Reorder In</th></tr></thead>
            <tbody className="divide-y divide-border">
              {data.forecast.map((f) => (
                <tr key={f.ingredient_id} className="bg-background">
                  <td className="px-3 py-2 text-foreground">{f.name}</td>
                  <td className="px-3 py-2 text-right text-foreground">{f.current_stock} {f.unit}</td>
                  <td className="px-3 py-2 text-right text-foreground">{f.daily_consumption} {f.unit}/day</td>
                  <td className={`px-3 py-2 text-right font-semibold ${(f.days_until_reorder ?? 99) <= 3 ? "text-red-600" : "text-foreground"}`}>
                    {f.days_until_reorder} day{f.days_until_reorder === 1 ? "" : "s"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.forecast.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">Not enough movement data to forecast yet.</p>}
        </div>
        <p className="mt-2 text-muted-foreground text-xs">Based on waste + usage over the selected period (sales deduct their recipe ingredients automatically; dishes without a recipe don&apos;t), projected forward at the same daily rate.</p>
      </div>
    </div>
  );
}

export default function AnalyticsView({ tillInUse = false }: { tillInUse?: boolean }) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [tab, setTab] = useState<"sales" | "menu" | "inventory">(tillInUse ? "sales" : "inventory");

  // Sales and Menu come from till orders: hidden while the till isn't used.
  const tabs = ([
    { id: "sales", label: "Sales", till: true },
    { id: "menu", label: "Menu", till: true },
    { id: "inventory", label: "Inventory", till: false },
  ] as const).filter((t) => tillInUse || !t.till);
  const tabLabel = tabs.find((t) => t.id === tab)?.label ?? "";

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4 print:hidden">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">Analytics Dashboard</h1>
              <p className="text-muted-foreground text-sm">Sales trends, busy hours and stock forecasts at a glance.</p>
            </div>
          </div>

          <div className={`flex flex-wrap gap-1 mt-4 bg-surface-hover p-1 rounded-xl ${tabs.length < 2 ? "hidden" : ""}`}>
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap ${tab === t.id ? "bg-red-500 text-white" : "text-muted-foreground"}`}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <PrintHeader title={`Analytics · ${tabLabel}`} from={from} to={to} />
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          <span className="text-muted-foreground">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          <button
            onClick={() => { setFrom(today()); setTo(today()); }}
            className={`px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${from === today() && to === today() ? "bg-red-600 border-red-500 text-white" : "bg-surface-hover border-border text-foreground hover:bg-elevated"}`}
          >
            Today
          </button>
          <span className="ml-auto"><PrintButton /></span>
        </div>

        <div className="mt-5">
          {tab === "sales" && tillInUse && <SalesTab from={from} to={to} />}
          {tab === "menu" && tillInUse && <MenuTab from={from} to={to} />}
          {tab === "inventory" && <InventoryTab from={from} to={to} />}
        </div>
      </div>
      </div>
    </>
  );
}
