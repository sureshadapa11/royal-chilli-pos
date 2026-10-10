"use client";

import { roleLabel } from "@/lib/roles";
import { useCallback, useEffect, useState } from "react";
import { useBrand } from "@/components/pos/useBrand";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatCurrency, hoursMinutes } from "@/lib/utils";
import { firstOfMonthStr, tradingDayStr } from "@/lib/london-date";

export default function StaffReportsView() {
  const [tab, setTab] = useState<"sales" | "staff" | "pending">("sales");

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4 print:hidden">
        <div className="mx-auto max-w-5xl flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">Reports</h1>
            <p className="text-muted-foreground text-sm">Sales &amp; operations, and staff hours &amp; labour cost.</p>
          </div>
        </div>
        <div className="mx-auto max-w-5xl mt-3 flex gap-1 bg-surface-hover p-1 rounded-xl w-fit">
          <button
            onClick={() => setTab("sales")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === "sales" ? "bg-red-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            📊 Sales
          </button>
          <button
            onClick={() => setTab("staff")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === "staff" ? "bg-red-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            🧑‍🤝‍🧑 Staff
          </button>
          <button
            onClick={() => setTab("pending")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${tab === "pending" ? "bg-red-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            📌 Pending Bills
          </button>
        </div>
      </div>

      <div className="px-4 py-6">
        <div className="mx-auto max-w-5xl">
          {tab === "sales" ? <SalesReport /> : tab === "staff" ? <StaffLabourReport /> : <PendingBillsReport />}
        </div>
      </div>
    </>
  );
}

// ── Pending Bills ────────────────────────────────────────────────────────
// View-only, admin-wide: every currently-outstanding Pay Later order across
// all dates. Actually collecting payment still only happens at the till, via
// the POS History screen's per-day Pending Bills filter — this is oversight,
// not a place to take money from.

interface PendingBill {
  id: number;
  order_number: string;
  order_type: string;
  total: number;
  amount_paid: number;
  outstanding: number;
  customer_name: string | null;
  customer_phone: string | null;
  table_number: string | null;
  staff_name: string | null;
  pay_later_note: string | null;
  created_at: string;
}

function PendingBillsReport() {
  const [bills, setBills] = useState<PendingBill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch("/api/reports/pending-bills")
        .then((r) => r.json())
        .then((d) => { setBills(d.orders || []); setTotal(d.total || 0); })
        .catch(() => { setBills([]); setTotal(0); })
        .finally(() => setLoading(false));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return <div className="text-center text-muted-foreground text-sm py-12">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 flex items-center justify-between">
        <div>
          <div className="text-amber-700 text-xs font-bold uppercase tracking-widest">Total Outstanding</div>
          <div className="text-muted-foreground text-xs mt-0.5">{bills.length} order{bills.length === 1 ? "" : "s"} still owed, across all dates</div>
        </div>
        <div className="text-amber-700 text-3xl font-black">{formatCurrency(total)}</div>
      </div>

      {bills.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-12">Nothing outstanding — every Pay Later order has been settled.</div>
      ) : (
        <div className="rounded-2xl border border-border scroll-x">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Order</th>
                <th className="text-left px-4 py-2.5 font-semibold">Customer</th>
                <th className="text-left px-4 py-2.5 font-semibold">Type</th>
                <th className="text-left px-4 py-2.5 font-semibold">Placed</th>
                <th className="text-left px-4 py-2.5 font-semibold">Staff</th>
                <th className="text-left px-4 py-2.5 font-semibold">Note</th>
                <th className="text-right px-4 py-2.5 font-semibold">Owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bills.map((b) => (
                <tr key={b.id} className="hover:bg-surface-hover/60">
                  <td className="px-4 py-2.5 text-foreground font-semibold">{b.order_number}</td>
                  <td className="px-4 py-2.5 text-foreground">
                    {b.order_type === "dine_in" ? `Table ${b.table_number ?? "?"}` : (b.customer_name || "Guest")}
                    {b.customer_phone && <span className="text-muted-foreground"> · {b.customer_phone}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {ORDER_TYPE_ICONS[b.order_type] ?? ""} {ORDER_TYPE_LABELS[b.order_type] ?? b.order_type}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(b.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{b.staff_name || "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{b.pay_later_note || "—"}</td>
                  <td className="px-4 py-2.5 text-right text-amber-700 font-bold">{formatCurrency(b.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sales & Operations ──────────────────────────────────────────────────────
// Was the standalone /pos/reports page — same data, same actions (CSV,
// receipt-printer print), now living inside Staff Hub's Reports.

interface ReportData {
  date: string;
  from: string;
  to: string;
  summary: { total_orders: number; total_revenue: number; avg_order_value: number; paid_orders: number };
  byType: Array<{ order_type: string; count: number; revenue: number }>;
  topItems: Array<{ item_name: string; quantity_sold: number; revenue: number }>;
  paymentSplit: Array<{ method: string; count: number; total: number }>;
  hourly: Array<{ hour: string; orders: number; revenue: number }>;
  cancellation: { cancelled_count: number; cancellation_rate: number };
  discountTotal: number;
  loyaltyTotal?: number;
  refundsTotal: number;
  voidValue: number;
  customers: { new: number; returning: number };
}
interface WeekDay { date: string; label: string; revenue: number; orders: number }

const ORDER_TYPE_LABELS: Record<string, string> = { dine_in: "Dine-In", takeaway: "Takeaway", delivery: "Delivery" };
const ORDER_TYPE_ICONS: Record<string, string> = { dine_in: "🍽️", takeaway: "🥡", delivery: "🛵" };

const todayStr = () => tradingDayStr();

function SalesReport() {
  const brand = useBrand();
  const [data, setData] = useState<ReportData | null>(null);
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [chartView, setChartView] = useState<"today" | "week">("today");
  const [weekData, setWeekData] = useState<WeekDay[]>([]);
  const [weekLoading, setWeekLoading] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports?from=${from}&to=${to}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch reports", err);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  function jumpToToday() {
    setFrom(todayStr());
    setTo(todayStr());
  }

  // Background refresh doesn't flip `loading` back on, so it can't flash
  // the loading state over someone reading the report.
  useEffect(() => {
    setLoading(true);
    fetchReports();
    const t = setInterval(fetchReports, 30000);
    return () => clearInterval(t);
  }, [fetchReports]);

  const fetchWeekData = async () => {
    setWeekLoading(true);
    try {
      const days: WeekDay[] = [];
      const base = tradingDayStr();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(`${base}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        try {
          const res = await fetch(`/api/reports?date=${dateStr}`);
          const json = await res.json();
          days.push({ date: dateStr, label, revenue: json?.summary?.total_revenue || 0, orders: json?.summary?.total_orders || 0 });
        } catch {
          days.push({ date: dateStr, label, revenue: 0, orders: 0 });
        }
      }
      setWeekData(days);
    } finally {
      setWeekLoading(false);
    }
  };

  useEffect(() => {
    if (chartView === "week") fetchWeekData();
  }, [chartView]);

  // Prints the whole report as it's shown on screen (every tile, the order
  // breakdown, top items, the full hourly table) rather than a narrow
  // receipt-style summary — the sidebar/topbar and this page's own controls
  // are hidden for print via the `print:hidden` classes below.
  const handlePrintReport = () => window.print();

  const hourlyData = Array.from({ length: 24 }, (_, h) => {
    const hourStr = h.toString().padStart(2, "0");
    const found = data?.hourly.find((x) => x.hour === hourStr);
    return { hour: `${h}:00`, orders: found?.orders || 0, revenue: found?.revenue || 0 };
  }).filter((h) => {
    const hr = parseInt(h.hour);
    return hr >= 7 && hr <= 23;
  });

  const isToday = from === todayStr() && to === todayStr();

  return (
    <div className="space-y-6">
      {/* Print-only header — the sticky page title and these controls are hidden for print */}
      <div className="hidden print:block mb-2">
        <h1 className="text-lg font-bold">{brand?.name} — Sales Report</h1>
        <p className="text-sm text-neutral-600">{isToday ? "Today" : from === to ? from : `${from} → ${to}`} · Printed {new Date().toLocaleString("en-GB")}</p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-surface-hover border border-border text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-surface-hover border border-border text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
          />
          <button
            onClick={jumpToToday}
            className={`px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${isToday ? "bg-red-600 border-red-500 text-white" : "bg-surface-hover border-border text-foreground hover:bg-elevated"}`}
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchReports} className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors">
            Load
          </button>
          <button onClick={handlePrintReport} disabled={!data} className="px-3 py-2 bg-elevated hover:bg-elevated-hover disabled:opacity-40 text-foreground text-sm font-semibold rounded-lg transition-colors">
            🖨️ Print Report
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-center mt-20 animate-pulse">Loading reports...</div>
      ) : !data ? (
        <div className="text-muted-foreground text-center mt-20">No data available</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Total Revenue</div>
              <div className="text-red-600 text-3xl font-bold">{formatCurrency(data.summary.total_revenue)}</div>
              <div className="text-muted-foreground text-xs mt-1">
                {isToday ? "Today" : from === to ? from : `${from} → ${to}`}
                {data.refundsTotal > 0 && <> · net of {formatCurrency(data.refundsTotal)} refunds</>}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Total Orders</div>
              <div className="text-blue-600 text-3xl font-bold">{data.summary.total_orders}</div>
              <div className="text-muted-foreground text-xs mt-1">{data.summary.paid_orders} paid</div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Avg Order Value</div>
              <div className="text-green-600 text-3xl font-bold">{formatCurrency(data.summary.avg_order_value)}</div>
              <div className="text-muted-foreground text-xs mt-1">per order</div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Payment Split</div>
              <div className="space-y-1 mt-2">
                {data.paymentSplit.map((p) => (
                  <div key={p.method} className="flex items-center justify-between">
                    <span className="text-foreground text-sm capitalize">{p.method === "cash" ? "💵 Cash" : "💳 Card"}</span>
                    <span className="text-foreground font-semibold text-sm">{formatCurrency(p.total)}</span>
                  </div>
                ))}
                {data.paymentSplit.length === 0 && <div className="text-muted-foreground text-sm">No payments yet</div>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Cancelled Orders</div>
              <div className={`text-3xl font-bold ${data.cancellation.cancellation_rate > 10 ? "text-red-600" : "text-foreground"}`}>{data.cancellation.cancelled_count}</div>
              <div className="text-muted-foreground text-xs mt-1">{data.cancellation.cancellation_rate}% of all orders</div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Discounts Given</div>
              <div className="text-amber-600 text-3xl font-bold">{formatCurrency(data.discountTotal)}</div>
              <div className="text-muted-foreground text-xs mt-1">
                across this period{(data.loyaltyTotal ?? 0) > 0 ? ` · + ${formatCurrency(data.loyaltyTotal ?? 0)} loyalty` : ""}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">Voided Items</div>
              <div className="text-amber-600 text-3xl font-bold">{formatCurrency(data.voidValue)}</div>
              <div className="text-muted-foreground text-xs mt-1">removed after being sent</div>
            </div>
            <div className="bg-surface border border-border rounded-2xl p-5">
              <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-2">New vs Returning</div>
              <div className="text-foreground text-3xl font-bold">{data.customers.new} <span className="text-muted-foreground text-lg font-medium">/ {data.customers.returning}</span></div>
              <div className="text-muted-foreground text-xs mt-1">new / returning customers</div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-2xl p-5">
            <h2 className="text-foreground font-bold text-base mb-4">Orders by Type</h2>
            <div className="grid grid-cols-3 gap-4">
              {["dine_in", "takeaway", "delivery"].map((type) => {
                const found = data.byType.find((t) => t.order_type === type);
                return (
                  <div key={type} className="bg-surface-hover rounded-xl p-4 text-center">
                    <div className="text-3xl mb-2">{ORDER_TYPE_ICONS[type]}</div>
                    <div className="text-foreground font-bold text-lg">{found?.count || 0}</div>
                    <div className="text-muted-foreground text-sm">{ORDER_TYPE_LABELS[type]}</div>
                    <div className="text-red-600 font-semibold text-sm mt-1">{formatCurrency(found?.revenue || 0)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-foreground font-bold text-base">{chartView === "today" ? "Hourly Sales" : "This Week"}</h2>
              <div className="flex items-center gap-1 bg-surface-hover rounded-lg p-1 print:hidden">
                <button
                  onClick={() => setChartView("today")}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${chartView === "today" ? "bg-red-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Selected Range
                </button>
                <button
                  onClick={() => setChartView("week")}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${chartView === "week" ? "bg-red-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                >
                  This Week
                </button>
              </div>
            </div>

            {chartView === "today" && (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <XAxis dataKey="hour" tick={{ fill: "#6b7280", fontSize: 11 }} interval={1} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px", color: "#fff" }}
                      formatter={(value: number) => [formatCurrency(value), "Revenue"]}
                    />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                      {hourlyData.map((entry, index) => (
                        <Cell key={index} fill={entry.revenue > 0 ? "#f97316" : "#374151"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {chartView === "week" &&
              (weekLoading ? (
                <div className="text-muted-foreground text-center py-8 animate-pulse">Loading week data...</div>
              ) : (
                <div className="overflow-x-auto">
                  {(() => {
                    const maxRevenue = Math.max(...weekData.map((d) => d.revenue), 1);
                    const busiestIdx = weekData.reduce((best, d, i) => (d.revenue > weekData[best].revenue ? i : best), 0);
                    return (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-muted-foreground font-semibold text-left py-2 pr-4">Day</th>
                            <th className="text-muted-foreground font-semibold text-right py-2 pr-4">Orders</th>
                            <th className="text-muted-foreground font-semibold text-right py-2 pr-6">Revenue</th>
                            <th className="text-muted-foreground font-semibold text-left py-2">Bar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weekData.map((day, idx) => (
                            <tr key={day.date} className={`border-b border-border ${idx === busiestIdx ? "bg-red-500/10" : "hover:bg-surface-hover/40"}`}>
                              <td className="py-2 pr-4">
                                <span className={`font-medium ${idx === busiestIdx ? "text-red-700" : "text-foreground"}`}>{day.label}</span>
                                {idx === busiestIdx && (
                                  <span className="ml-2 text-[10px] font-bold text-red-600 bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 rounded-full">Busiest</span>
                                )}
                              </td>
                              <td className="text-foreground font-semibold text-right py-2 pr-4">{day.orders}</td>
                              <td className="text-red-600 font-semibold text-right py-2 pr-6">{formatCurrency(day.revenue)}</td>
                              <td className="py-2 w-32">
                                <div className="h-2 bg-surface-hover rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${idx === busiestIdx ? "bg-red-500" : "bg-red-700"}`} style={{ width: `${(day.revenue / maxRevenue) * 100}%` }} />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              ))}
          </div>

          <div className="bg-surface border border-border rounded-2xl p-5">
            <h2 className="text-foreground font-bold text-base mb-4">Top Selling Items</h2>
            {data.topItems.length === 0 ? (
              <div className="text-muted-foreground text-sm">No sales data yet</div>
            ) : (
              <div className="space-y-2">
                {data.topItems.map((item, idx) => (
                  <div key={item.item_name} className="flex items-center gap-3 py-2">
                    <span className="text-muted-foreground font-bold text-sm w-6 text-center">{idx + 1}</span>
                    <div className="flex-1">
                      <div className="text-foreground text-sm font-medium">{item.item_name}</div>
                      <div className="h-1.5 bg-surface-hover rounded-full mt-1.5 overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full" style={{ width: `${(item.quantity_sold / data.topItems[0].quantity_sold) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-foreground text-sm font-semibold">{item.quantity_sold} sold</div>
                      <div className="text-red-600 text-xs">{formatCurrency(item.revenue)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-2xl p-5">
            <h2 className="text-foreground font-bold text-base mb-4">Hourly Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-muted-foreground font-semibold text-left py-2 pr-4">Hour</th>
                    <th className="text-muted-foreground font-semibold text-right py-2 pr-4">Orders</th>
                    <th className="text-muted-foreground font-semibold text-right py-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hourly.map((row) => (
                    <tr key={row.hour} className="border-b border-border hover:bg-surface-hover/50">
                      <td className="text-foreground py-2 pr-4">{row.hour}:00</td>
                      <td className="text-foreground font-semibold text-right py-2 pr-4">{row.orders}</td>
                      <td className="text-red-600 font-semibold text-right py-2">{formatCurrency(row.revenue)}</td>
                    </tr>
                  ))}
                  {data.hourly.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-muted-foreground text-center py-4">No sales data for this date</td>
                    </tr>
                  )}
                </tbody>
                {data.hourly.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-elevated">
                      <td className="text-foreground font-bold py-2 pr-4">Total</td>
                      <td className="text-foreground font-bold text-right py-2 pr-4">{data.summary.total_orders}</td>
                      <td className="text-red-600 font-bold text-right py-2">{formatCurrency(data.summary.total_revenue)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Staff & Labour ───────────────────────────────────────────────────────────
// Was the standalone Staff Reports screen — hours worked, late count and
// labour cost per employee, for any date range.

type StaffRow = { staff_id: number; name: string; role: string; hours_worked: number; minutes_worked: number; late_count: number; pay_rate: number; labour_cost: number };

function firstOfMonth() {
  return firstOfMonthStr(tradingDayStr());
}
function today() {
  return tradingDayStr();
}

function StaffLabourReport() {
  const brand = useBrand();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [totals, setTotals] = useState({ hours: 0, minutes: 0, cost: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff-reports?from=${from}&to=${to}`);
    const data = await res.json();
    setRows(data.rows || []);
    setTotals(data.totals || { hours: 0, minutes: 0, cost: 0 });
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const isToday = from === today() && to === today();

  return (
    <div>
      {/* Print-only header — the controls below and the parent tab bar are hidden for print */}
      <div className="hidden print:block mb-2">
        <h1 className="text-lg font-bold text-foreground">{brand?.name} — Staff Hours &amp; Labour Cost</h1>
        <p className="text-sm text-muted-foreground">{isToday ? "Today" : `${from} → ${to}`} · Printed {new Date().toLocaleString("en-GB")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <span className="text-muted-foreground">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <button
          onClick={() => { setFrom(today()); setTo(today()); }}
          className={`px-3 py-2 text-sm font-semibold rounded-lg border transition-colors ${isToday ? "bg-red-600 border-red-500 text-white" : "bg-surface-hover border-border text-foreground hover:bg-elevated"}`}
        >
          Today
        </button>
        <button onClick={() => window.print()} className="px-4 py-2 bg-surface-hover hover:bg-elevated text-foreground text-sm font-semibold rounded-lg border border-border">🖨️ Print Report</button>
      </div>

      <p className="mt-3 text-muted-foreground text-sm">
        Total hours: <span className="text-foreground font-semibold">{hoursMinutes(totals.minutes / 60)}</span> · Total labour cost:{" "}
        <span className="text-foreground font-semibold">£{totals.cost.toFixed(2)}</span>
      </p>
      <p className="mt-1 text-muted-foreground text-xs print:hidden">
        Hours count every closed shift (clocked in and out) in this range, live — a still-open shift doesn&apos;t count until it&apos;s clocked out. A manager correction to a punch is reflected here immediately.
      </p>

      <div className="mt-4 rounded-xl border border-border overflow-x-auto">
        {loading ? (
          <div className="text-muted-foreground text-center py-16">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-right px-4 py-3">Hours</th>
                <th className="text-right px-4 py-3">Late</th>
                <th className="text-right px-4 py-3">Pay Rate</th>
                <th className="text-right px-4 py-3">Labour Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.staff_id} className="bg-background">
                  <td className="px-4 py-3 text-foreground font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-foreground capitalize">{roleLabel(r.role)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{hoursMinutes(r.minutes_worked / 60)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{r.late_count}</td>
                  <td className="px-4 py-3 text-right text-foreground">£{r.pay_rate.toFixed(2)}/hr</td>
                  <td className="px-4 py-3 text-right text-foreground">£{r.labour_cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
