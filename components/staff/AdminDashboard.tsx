"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import type { AdminDashboard as Data, RangeKey } from "@/lib/admin-dashboard";

// Admin-only Staff Hub home. Fixed colour per channel (never by rank), one
// y-axis per chart, hover tooltips everywhere, legends on multi-series charts.
const S = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", s4: "#eda100", s5: "#e87ba4", s6: "#4a3aa7", s7: "#0e8a8c", neutral: "#B9B0A4" };
const CHANNEL_COLOUR: Record<string, string> = {
  dine_in: S.s1, takeaway: S.s2, delivery: S.s3, just_eat: S.s4, uber_eats: S.s5, deliveroo: S.s6, hiest: S.s7,
};
const GRID = "#F0EBDF";
const INK_MUTED = "#8A8078";
const GOOD = "#1F7A4D";
const TOOLTIP = { borderRadius: 10, border: "1px solid #ECE5D6", fontSize: 12.5, boxShadow: "0 8px 24px -8px rgba(32,27,24,0.18)" };
const AXIS = { fontSize: 11.5, fill: INK_MUTED };

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", this_week: "This week", last_week: "Last week", this_month: "This month", last_month: "Last month",
};
// The Summary card's periods (whole weeks/months; "Today" has its own card).
const SUMMARY_RANGES: RangeKey[] = ["this_week", "last_week", "this_month", "last_month"];

const heading = { fontFamily: "var(--font-space-grotesk)" };
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const gbp2 = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (v: unknown) => gbp2(Number(v));

function Card({ title, sub, action, children, className = "" }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-[#ECE5D6] bg-white px-[18px] py-4 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 style={heading} className="text-[15px] font-semibold text-foreground">{title}</h2>
        {sub && <span className="text-[12.5px] text-muted-foreground">{sub}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <span className="text-[12.5px] text-muted-foreground">No sales {label} to compare</span>;
  const up = pct >= 0;
  return (
    <span className="text-[12.5px] font-semibold" style={{ color: up ? GOOD : "#C0392B" }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% <span className="font-normal text-muted-foreground">vs {label}</span>
    </span>
  );
}

function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3.5 text-[12.5px] text-[#5B524B]">
      {items.map((i) => (
        <span key={i.label}><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: i.colour }} />{i.label}</span>
      ))}
    </div>
  );
}

export default function AdminDashboard({ data }: { data: Data; businessName?: string }) {
  const router = useRouter();
  const { summary: sm } = data;

  // Days still to come this week draw as gaps, not as £0.
  const week = data.week.map((d) => ({ ...d, revenueSoFar: d.date <= data.today ? d.revenue : null }));
  const channelTotal = data.channels.reduce((s, c) => s + c.revenue, 0);
  const channelsWithSales = data.channels.filter((c) => c.revenue > 0);
  const avgSpend = data.channels.filter((c) => c.orders > 0).map((c) => ({ ...c, avg: Math.round((c.revenue / c.orders) * 100) / 100 }));
  const topMax = Math.max(1, ...data.topDishes.map((d) => d.revenue));
  const plat = data.platforms.reduce((t, p) => ({ orders: t.orders + p.orders, sales: t.sales + p.sales, commission: t.commission + p.commission, keep: t.keep + p.keep }), { orders: 0, sales: 0, commission: 0, keep: 0 });

  // The cost lines the owner wants (agreed 2026-10-03), £0 included. Rent,
  // utilities, equipment and professional fees are counted in "Other
  // expenses", so the lines still add up to Total costs.
  const marketing = sm.costs.expenseLines.find((l) => l.key === "marketing")?.amount ?? 0;
  const otherExpenses = Math.round(sm.costs.expenseLines.filter((l) => l.key !== "marketing").reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const costs: [string, number][] = [
    ["Staff pay", sm.costs.staff],
    ["Marketing", marketing],
    ["Other expenses", otherExpenses],
    ["Ingredients & supplies", sm.costs.ingredients],
    ["Platform commission", sm.costs.commission],
    ["Card fees (est.)", sm.costs.cardFees],
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: today · this week · summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.35fr]">
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

        <Card title="This week's revenue" sub="Mon–Sun">
          <p style={heading} className="text-[34px] font-bold leading-tight tracking-[-0.02em]">{gbp2(data.weekRevenue)}</p>
          <Delta pct={data.weekVsLastWeekPct} label="last week so far" />
          <div className="mt-1.5 h-[70px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={week} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <defs><linearGradient id="g-week" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={S.s1} stopOpacity={0.25} /><stop offset="100%" stopColor={S.s1} stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="label" hide />
                <Tooltip contentStyle={TOOLTIP} formatter={(v) => [money(v), "Revenue"]} />
                <Area type="monotone" dataKey="revenueSoFar" stroke={S.s1} strokeWidth={2} fill="url(#g-week)" connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Summary" className="md:col-span-2 xl:col-span-1">
          <div className="mb-3 mt-1 flex flex-wrap gap-2">
            <select aria-label="Date range" value={sm.range} onChange={(e) => router.push(`/staff?range=${e.target.value}`, { scroll: false })}
              className="rounded-[9px] border border-[#ECE5D6] bg-[#FBF8F1] px-2.5 py-1.5 text-[13px]">
              {SUMMARY_RANGES.map((k) => <option key={k} value={k}>{RANGE_LABELS[k]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Total sales", sm.totalSales, ""],
              ["Ex VAT", sm.exVat, ""],
              ["Costs", sm.costs.total, ""],
              ["Profit", sm.profit, "profit"],
            ].map(([label, v, kind]) => (
              <div key={label as string} className={`rounded-xl px-3 py-2.5 ${kind ? (Number(v) >= 0 ? "bg-[#E7F5EC]" : "bg-[#FDECE9]") : "bg-[#FBF8F1]"}`}>
                <span className="block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{label}</span>
                <b style={{ ...heading, color: kind ? (Number(v) >= 0 ? GOOD : "#C0392B") : undefined }} className="mt-0.5 block text-[20px] font-bold tabular-nums">{gbp(Number(v))}</b>
              </div>
            ))}
          </div>
          <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px] text-[#5B524B]">
            {costs.map(([k, v]) => (
              <div key={k} className="contents"><span>{k}</span><span className="text-right tabular-nums text-foreground">{gbp2(v)}</span></div>
            ))}
            <span className="border-t border-[#ECE5D6] pt-1 font-semibold text-foreground">Total costs</span>
            <span className="border-t border-[#ECE5D6] pt-1 text-right font-semibold tabular-nums text-foreground">{gbp2(sm.costs.total)}</span>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">Profit = sales ex VAT − costs. Staff pay is from clocked-out shifts × pay rate.</p>

        </Card>
      </div>

      {/* Row 2: sales trend · week vs week */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Sales trend" sub="Revenue, this week Mon–Sun">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={week} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => gbp(v)} width={56} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v) => [money(v), "Revenue"]} />
                <Line type="monotone" dataKey="revenueSoFar" stroke={S.s1} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="This week vs last week" action={<Legend items={[{ label: "This week", colour: S.s1 }, { label: "Last week", colour: S.neutral }]} />}>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={week} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barGap={2}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => gbp(v)} width={56} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [money(v), n === "revenue" ? "This week" : "Last week"]} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                <Bar dataKey="revenue" fill={S.s1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="lastWeek" fill={S.neutral} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Row 3: channels · staff cost */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

        <Card title="Staff cost vs revenue" action={<Legend items={[{ label: "Revenue", colour: S.s1 }, { label: "Staff cost", colour: S.s2 }]} />}>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={week} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barGap={2}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => gbp(v)} width={56} />
                <Tooltip
                  contentStyle={TOOLTIP}
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                  formatter={(v, n, item) => {
                    if (n !== "staffCost") return [money(v), "Revenue"];
                    const rev = Number(item.payload.revenue);
                    return [`${money(v)}${rev > 0 ? ` · ${Math.round((Number(v) / rev) * 100)}% of revenue` : ""}`, "Staff cost"];
                  }}
                />
                <Bar dataKey="revenue" fill={S.s1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="staffCost" fill={S.s2} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Row 4: top dishes · average spend */}
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

      {/* Row 5: delivery platforms */}
      <Card
        title="Delivery platforms"
        sub="This week · entered daily from each tablet's summary"
        action={<Link href="/staff/platforms" className="text-[13px] font-semibold text-[#C82D1D] hover:underline">Enter totals →</Link>}
      >
        {data.platformsMissingYesterday && (
          <p className="mb-2 rounded-lg bg-[#FFF4D6] px-3 py-2 text-[12.5px] text-[#8A5A00]">Yesterday&apos;s platform totals haven&apos;t been entered yet.</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[13.5px]">
            <thead>
              <tr className="text-[11.5px] uppercase tracking-[0.04em] text-muted-foreground">
                <th className="py-1.5 text-left font-semibold">Platform</th>
                <th className="py-1.5 text-right font-semibold">Orders</th>
                <th className="py-1.5 text-right font-semibold">Sales</th>
                <th className="py-1.5 text-right font-semibold">Commission</th>
                <th className="py-1.5 text-right font-semibold">You keep</th>
              </tr>
            </thead>
            <tbody>
              {data.platforms.map((p) => (
                <tr key={p.key} className="border-t border-[#F0EBDF]">
                  <td className="py-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: CHANNEL_COLOUR[p.key] }} />{p.label}</td>
                  <td className="py-2 text-right tabular-nums">{p.orders}</td>
                  <td className="py-2 text-right tabular-nums">{gbp2(p.sales)}</td>
                  <td className="py-2 text-right tabular-nums">{gbp2(p.commission)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums" style={{ color: GOOD }}>{gbp2(p.keep)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#ECE5D6] font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-right tabular-nums">{plat.orders}</td>
                <td className="py-2 text-right tabular-nums">{gbp2(plat.sales)}</td>
                <td className="py-2 text-right tabular-nums">{gbp2(plat.commission)}</td>
                <td className="py-2 text-right tabular-nums" style={{ color: GOOD }}>{gbp2(plat.keep)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
