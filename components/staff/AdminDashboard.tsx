"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import type { AdminDashboard as Data, AdminSummary, RangeKey } from "@/lib/admin-dashboard";
import type { DashboardCards } from "@/lib/dashboard-cards";
import { AXIS, CHANNEL_COLOUR, GOOD, GRID, S, TOOLTIP, Card, gbp, gbp2, heading, money } from "@/components/staff/dashboard-kit";
import {
  CashCheckCard, DailySalesCard, LatestDayCard, MoneyOutCard, NetByDayCard, PeriodSalesCard,
  PlatformsCard, SalesMixCard, StaffCard, usePeriods,
} from "@/components/staff/DashboardCards";

// Staff Hub home for Super admins and Managers. One period (the buttons at the
// top) drives the Summary and every card built from what is entered by hand —
// Daily accounts, Expenses, deliveries and Attendance — so the dashboard works
// without the till. The till-only cards (sales by hour, channels, dishes,
// average spend) appear once real till orders exist.

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", this_week: "This week", last_week: "Last week", this_month: "This month", last_month: "Last month",
};
const PERIODS: RangeKey[] = ["this_week", "last_week", "this_month", "last_month"];

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <span className="text-[12.5px] text-muted-foreground">No sales {label} to compare</span>;
  const up = pct >= 0;
  return (
    <span className="text-[12.5px] font-semibold" style={{ color: up ? GOOD : "#C0392B" }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% <span className="font-normal text-muted-foreground">vs {label}</span>
    </span>
  );
}

function SummaryCard({ summary, loading, error }: { summary: AdminSummary; loading: boolean; error: string }) {
  const marketing = summary.costs.expenseLines.find((l) => l.key === "marketing")?.amount ?? 0;
  const otherExpenses = Math.round(summary.costs.expenseLines.filter((l) => l.key !== "marketing").reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const costs: [string, number][] = [
    ["Staff pay", summary.costs.staff],
    ["Marketing", marketing],
    ["Other expenses", otherExpenses],
    ["Stock received", summary.costs.ingredients],
    ["Platform commission", summary.costs.commission],
    ["Card fees", summary.costs.cardFees],
    ["Till paid out", summary.costs.paidOut],
  ];

  return (
    <Card title="Summary" className="md:col-span-2 xl:col-span-1">
      <div aria-busy={loading}>
        {error && <p className="mb-2 text-[12px] text-[#C0392B]" role="alert">{error}</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Total sales", summary.totalSales, ""],
            ["Ex VAT", summary.exVat, ""],
            ["Costs", summary.costs.total, ""],
            ["Profit", summary.profit, "profit"],
          ].map(([label, value, kind]) => (
            <div key={label as string} className={`rounded-xl px-3 py-2.5 ${kind ? (Number(value) >= 0 ? "bg-[#E7F5EC]" : "bg-[#FDECE9]") : "bg-[#FBF8F1]"}`}>
              <span className="block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</span>
              <b style={{ ...heading, color: kind ? (Number(value) >= 0 ? GOOD : "#C0392B") : undefined }} className="mt-0.5 block text-[20px] font-bold tabular-nums">{gbp(Number(value))}</b>
            </div>
          ))}
        </div>
        <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px] text-[#5B524B]">
          {costs.map(([label, amount]) => (
            <div key={label} className="contents"><span>{label}</span><span className="text-right tabular-nums text-foreground">{gbp2(amount)}</span></div>
          ))}
          <span className="border-t border-[#ECE5D6] pt-1 font-semibold text-foreground">Total costs</span>
          <span className="border-t border-[#ECE5D6] pt-1 text-right font-semibold tabular-nums text-foreground">{gbp2(summary.costs.total)}</span>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Total sales = Z report (tips not included) + delivery platforms + catering. Profit = sales ÷ 1.2 − costs. Staff pay is clocked-out hours × pay rate. Same figures as Finance and All businesses.</p>
      </div>
    </Card>
  );
}

export default function AdminDashboard({ data }: { data: Data; businessName?: string }) {
  const [range, setRange] = useState<RangeKey>(data.summary.range);
  const [summary, setSummary] = useState(data.summary);
  const [cards, setCards] = useState<DashboardCards>(data.cards);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const p = usePeriods(cards);

  // Only the Summary and the cards reload; the rest of the page stays put.
  async function changeRange(next: RangeKey) {
    if (next === range || loading) return;
    const was = range;
    setRange(next);
    setLoading(true);
    setError("");
    try {
      const [s, c] = await Promise.all([
        fetch(`/api/staff/dashboard-summary?range=${next}`, { cache: "no-store" }),
        fetch(`/api/staff/dashboard-cards?range=${next}`, { cache: "no-store" }),
      ]);
      if (!s.ok || !c.ok) throw new Error("Couldn't load this period. Please try again.");
      setSummary(await s.json() as AdminSummary);
      setCards(await c.json() as DashboardCards);
    } catch (e) {
      setRange(was);
      setError(e instanceof Error ? e.message : "Couldn't load this period. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const channelTotal = data.channels.reduce((s, c) => s + c.revenue, 0);
  const channelsWithSales = data.channels.filter((c) => c.revenue > 0);
  const avgSpend = data.channels.filter((c) => c.orders > 0).map((c) => ({ ...c, avg: Math.round((c.revenue / c.orders) * 100) / 100 }));
  const topMax = Math.max(1, ...data.topDishes.map((d) => d.revenue));
  const dailyAccountsMissing = Math.max(0, data.dailyAccounts.daysSoFar - data.dailyAccounts.submitted);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Period" className="inline-flex gap-0.5 rounded-xl border border-[#ECE5D6] bg-white p-[3px]">
          {PERIODS.map((k) => (
            <button key={k} type="button" aria-pressed={range === k} disabled={loading} onClick={() => void changeRange(k)}
              className={`rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-wait ${range === k ? "bg-[#201B18] text-white" : "text-[#5B524B] hover:bg-[#FBF8F1]"}`}>
              {RANGE_LABELS[k]}
            </button>
          ))}
        </div>
        {loading && <span className="text-[12.5px] text-muted-foreground" role="status">Updating…</span>}
        {error && <span className="text-[12.5px] text-[#C0392B]" role="alert">{error}</span>}
      </div>

      <div aria-busy={loading} className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {/* Row 1: latest day · the period's sales · summary */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.35fr]">
          <LatestDayCard p={p} />
          <PeriodSalesCard p={p} />
          <SummaryCard summary={summary} loading={loading} error="" />
        </div>

        {/* Row 2: daily sales · sales mix */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DailySalesCard p={p} />
          <SalesMixCard p={p} />
        </div>

        {/* Row 3: net total by day · money out */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <NetByDayCard p={p} />
          <MoneyOutCard p={p} />
        </div>

        {/* Row 4: delivery platforms · cash check */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PlatformsCard p={p} />
          <CashCheckCard p={p} />
        </div>

        {/* Row 5: staff vs sales */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StaffCard p={p} />
        </div>
      </div>

      {/* Till orders: only once the till is in use (they'd be empty otherwise) */}
      {data.hasTill && (
        <>
          <h2 style={heading} className="mt-2 text-[15px] font-semibold text-[#5B524B]">From the till · this week</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="Today's revenue" sub="by hour">
              <p style={heading} className="text-[34px] font-bold leading-tight tracking-[-0.02em]">{gbp2(data.todayRevenue)}</p>
              <Delta pct={data.todayVsLastWeekPct} label="same day last week" />
              <div className="mt-1.5 h-[70px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.todayHourly} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                    <defs><linearGradient id="g-today" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={S.s1} stopOpacity={0.25} /><stop offset="100%" stopColor={S.s1} stopOpacity={0} /></linearGradient></defs>
                    <XAxis dataKey="hour" hide />
                    <Tooltip contentStyle={TOOLTIP} formatter={(v) => [money(v), "Revenue"]} />
                    <Area type="monotone" dataKey="revenue" stroke={S.s1} strokeWidth={2} fill="url(#g-today)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Revenue by channel" sub="This week">
              <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[200px_1fr]">
                <div className="relative h-[200px]">
                  {channelTotal > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={channelsWithSales} dataKey="revenue" nameKey="label" innerRadius={62} outerRadius={92} paddingAngle={1} stroke="#fff" strokeWidth={2}>
                          {channelsWithSales.map((c) => <Cell key={c.key} fill={CHANNEL_COLOUR[c.key]} />)}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [`${money(v)} · ${Math.round((Number(v) / channelTotal) * 100)}%`, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center rounded-full border-[14px] border-[#F0EBDF]" />
                  )}
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                    <div><b style={heading} className="block text-[20px] font-bold">{gbp(channelTotal)}</b><span className="text-[11.5px] text-muted-foreground">total</span></div>
                  </div>
                </div>
                <table className="w-full text-[13px]">
                  <tbody>
                    {data.channels.map((c) => (
                      <tr key={c.key} className="border-b border-[#F0EBDF] last:border-0">
                        <td className="py-1.5">
                          <span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: CHANNEL_COLOUR[c.key] }} />
                          {c.label}{c.platform && <span className="ml-1 text-[11.5px] text-muted-foreground">platform</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{gbp(c.revenue)}</td>
                        <td className="w-12 py-1.5 text-right tabular-nums text-muted-foreground">{channelTotal > 0 ? Math.round((c.revenue / channelTotal) * 100) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="Top-selling dishes" sub="By revenue, this week">
              {data.topDishes.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">No dishes sold yet this week.</p>
              ) : (
                <div className="mt-1.5 flex flex-col gap-3">
                  {data.topDishes.map((d, i) => (
                    <div key={d.name} className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5" title={`${d.name}: ${gbp2(d.revenue)} · ${d.qty} sold`}>
                      <span style={heading} className="text-[14px] font-bold text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold">{d.name}</div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#F0EBDF]">
                          <div className="h-full rounded-full" style={{ width: `${(d.revenue / topMax) * 100}%`, background: S.s1 }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div style={heading} className="text-[14px] font-semibold tabular-nums">{gbp2(d.revenue)}</div>
                        <div className="text-[11.5px] text-muted-foreground">{d.qty} sold</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[12px] text-muted-foreground">From till, QR and website orders. Delivery platform orders aren&apos;t itemised, so they&apos;re not included here.</p>
            </Card>

            <Card title="Average spend" sub="Per order, this week">
              {avgSpend.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">No orders yet this week.</p>
              ) : (
                <div style={{ height: Math.max(120, avgSpend.length * 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={avgSpend} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} horizontal={false} />
                      <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => gbp(v)} />
                      <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: "#5B524B" }} axisLine={false} tickLine={false} width={116} />
                      <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(0,0,0,0.03)" }} formatter={(v, _n, item) => [`${money(v)} · ${item.payload.orders} orders`, "Average"]} />
                      <Bar dataKey="avg" radius={[0, 4, 4, 0]} maxBarSize={20} label={{ position: "right", fontSize: 12, fill: "#201B18", formatter: (v: unknown) => gbp2(Number(v)) }}>
                        {avgSpend.map((c) => <Cell key={c.key} fill={CHANNEL_COLOUR[c.key]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Daily accounts: this week's saved sheets */}
      <Card
        title="Daily Accounts"
        sub="This week · saved day-end figures"
        action={<Link href="/staff/daily-accounts" className="text-[13px] font-semibold text-[#C82D1D] hover:underline">Open Daily Accounts →</Link>}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Cash", data.dailyAccounts.cash],
            ["Bank in", data.dailyAccounts.bankIn],
            ["Cash not banked", data.dailyAccounts.notBanked],
            ["Pending bills", data.dailyAccounts.pending],
            ["Catering paid", data.dailyAccounts.cateringPaid],
            ["Catering pending", data.dailyAccounts.cateringPending],
          ].map(([label, amount]) => (
            <div key={label as string} className="rounded-xl bg-[#FBF8F1] px-3 py-2.5">
              <span className="block text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
              <b style={heading} className="mt-0.5 block text-[18px] font-bold tabular-nums">{gbp2(Number(amount))}</b>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
          <span>{data.dailyAccounts.submitted} of {data.dailyAccounts.daysSoFar} days submitted</span>
          {dailyAccountsMissing > 0 && <span>{dailyAccountsMissing} day{dailyAccountsMissing === 1 ? "" : "s"} not submitted</span>}
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">Daily Accounts figures include saved drafts. They are shown separately and do not change sales or profit.</p>
      </Card>
    </div>
  );
}
