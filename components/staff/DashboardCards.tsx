"use client";

import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { CardDay, DashboardCards } from "@/lib/dashboard-cards";
import { CARD_PLATFORMS } from "@/lib/dashboard-cards-meta";
import { hoursMinutes } from "@/lib/utils";
import {
  AXIS, BAD, CHANNEL_COLOUR, COST, GOOD, GRID, HOURS, INK_2, PREV, SOURCE_COLOUR, TOOLTIP,
  Card, Change, Legend, Stat, gbp, gbp2, heading, money,
} from "@/components/staff/dashboard-kit";

// The dashboard cards that work without the till — all from what is entered by
// hand (Daily accounts, Expenses, stock deliveries, Attendance), for the period
// picked at the top of the dashboard, next to the period before.

const NAMES: Record<DashboardCards["range"], [string, string]> = {
  today: ["Today", "Same day last week"],
  this_week: ["This week", "Last week"],
  last_week: ["Last week", "Week before"],
  this_month: ["This month", "Last month"],
  last_month: ["Last month", "Month before"],
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (days: CardDay[], f: (d: CardDay) => number) => r2(days.reduce((s, d) => s + f(d), 0));
const platformSales = (d: CardDay) => CARD_PLATFORMS.reduce((s, p) => s + d.platforms[p.key].sales, 0);
const pct1 = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const dayName = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

/** Everything the cards share: the two periods, "so far" slices, labels. */
export function usePeriods(cards: DashboardCards) {
  const [curName, prevName] = NAMES[cards.range];
  const { cur, prev, today } = cards;
  const finished = cur.to < today;
  const soFar = cur.days.filter((d) => finished || d.date <= today);
  const prevSoFar = finished ? prev.days : prev.days.slice(0, soFar.length);
  const weekly = cards.range.endsWith("week");
  const label = (d: string) => (weekly ? dayName(d, { weekday: "short" }) : dayName(d, { day: "numeric" }));
  return { curName, prevName, cur: cur.days, prev: prev.days, soFar, prevSoFar, today, label, from: cur.from, to: cur.to };
}
type P = ReturnType<typeof usePeriods>;

// ── 1. Latest day ───────────────────────────────────────────────────────────
export function LatestDayCard({ p }: { p: P }) {
  const latest = [...p.soFar].reverse().find((d) => d.sheet || d.total);
  const lastWeek = latest ? [...p.prev, ...p.cur].find((d) => d.date === addDays(latest.date, -7)) : undefined;
  return (
    <Card title="Latest day" sub="Most recent day with figures">
      {!latest ? <Empty text="No days entered in this period yet." /> : (
        <>
          <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {dayName(latest.date, { weekday: "long", day: "numeric", month: "long" })}{latest.sheet ? "" : " · till only"}
          </p>
          <p style={heading} className="text-[32px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{gbp2(latest.total)}</p>
          <Change cur={latest.total} prev={lastWeek?.total ?? 0} label="Same day last week" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Net total" value={gbp2(latest.net)} tone={latest.net < 0 ? "bad" : "good"} />
            <Stat label="Card" value={gbp2(latest.card)} />
            <Stat label="Cash" value={gbp2(latest.cash)} />
            <Stat label="Platforms" value={gbp2(platformSales(latest))} />
          </div>
        </>
      )}
    </Card>
  );
}

// ── 2. The period's sales, with which days have a sheet ─────────────────────
export function PeriodSalesCard({ p }: { p: P }) {
  const total = sum(p.soFar, (d) => d.total);
  const before = sum(p.prevSoFar, (d) => d.total);
  const entered = p.cur.filter((d) => d.sheet).length;
  const spark = p.soFar.map((d) => ({ label: p.label(d.date), total: d.total }));
  return (
    <Card title={`${p.curName}'s sales`} sub={`${dayName(p.from)} – ${dayName(p.to)}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,140px)] items-end gap-3">
        <div className="min-w-0">
          <p style={heading} className="text-[32px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{gbp2(total)}</p>
          <Change cur={total} prev={before} label={`${p.prevName} to the same day`} />
        </div>
        <div className="h-[52px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
              <defs><linearGradient id="g-period" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SOURCE_COLOUR.till} stopOpacity={0.18} /><stop offset="100%" stopColor={SOURCE_COLOUR.till} stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="label" hide />
              <Tooltip contentStyle={TOOLTIP} formatter={(v) => [money(v), "Sales"]} />
              <Area type="monotone" dataKey="total" stroke={SOURCE_COLOUR.till} strokeWidth={2} fill="url(#g-period)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mb-1.5 mt-3 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Days entered · {entered} of {p.soFar.length}</p>
      <div className="flex flex-wrap gap-1">
        {p.cur.map((d) => {
          const state = d.date > p.today ? "future" : d.sheet ? "sheet" : d.tillOnly && d.total ? "till" : "none";
          const text = { sheet: "sheet entered", till: "till payments only, no sheet", none: "nothing entered", future: "still to come" }[state];
          return (
            <span key={d.date} title={`${dayName(d.date)} · ${text}`}
              className={`h-4 w-4 rounded-[5px] ${state === "sheet" ? "bg-[#1F7A4D]" : state === "till" ? "bg-[#F2C14E]" : state === "none" ? "bg-[#F3EEE3] ring-1 ring-inset ring-[#EAE3D3]" : "border border-dashed border-[#EAE3D3]"}`} />
          );
        })}
      </div>
      <div className="mt-2">
        <Legend items={[{ label: "Sheet", colour: GOOD }, { label: "Till only", colour: "#F2C14E" }, { label: "Missing", colour: "#E4DDCF" }]} />
      </div>
    </Card>
  );
}

// ── 3. Daily sales by source, the period before as a line ───────────────────
export function DailySalesCard({ p }: { p: P }) {
  const data = p.cur.map((d, i) => ({
    label: p.label(d.date), date: d.date, till: d.till, platforms: r2(platformSales(d)), catering: d.catering,
    prev: p.prev[i]?.total ?? null, prevDate: p.prev[i]?.date,
  }));
  return (
    <Card title="Daily sales" sub={`Total sales per day by source · grey line: ${p.prevName.toLowerCase()}`} className="md:col-span-2">
      <Legend items={[
        { label: "Till (Z report)", colour: SOURCE_COLOUR.till }, { label: "Delivery platforms", colour: SOURCE_COLOUR.platforms },
        { label: "Catering", colour: SOURCE_COLOUR.catering }, { label: p.prevName, colour: PREV, line: true },
      ]} />
      <div className="mt-2 h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => gbp(v)} width={56} />
            <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(0,0,0,0.03)" }}
              labelFormatter={(_l, items) => (items?.[0] ? dayName(items[0].payload.date) : "")}
              formatter={(v, n) => [money(v), { till: "Till", platforms: "Platforms", catering: "Catering", prev: p.prevName }[String(n)] ?? n]} />
            <Bar dataKey="till" stackId="s" fill={SOURCE_COLOUR.till} maxBarSize={24} />
            <Bar dataKey="platforms" stackId="s" fill={SOURCE_COLOUR.platforms} maxBarSize={24} />
            <Bar dataKey="catering" stackId="s" fill={SOURCE_COLOUR.catering} maxBarSize={24} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="prev" stroke={PREV} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── 4. Sales mix ────────────────────────────────────────────────────────────
export function SalesMixCard({ p }: { p: P }) {
  const parts = [
    { key: "till", label: "Till (Z report)", colour: SOURCE_COLOUR.till, value: sum(p.cur, (d) => d.till) },
    { key: "catering", label: "Catering", colour: SOURCE_COLOUR.catering, value: sum(p.cur, (d) => d.catering) },
    ...(["uber_eats", "just_eat", "deliveroo", "hiest"] as const).map((k) => ({
      key: k, label: CARD_PLATFORMS.find((x) => x.key === k)!.label, colour: CHANNEL_COLOUR[k], value: sum(p.cur, (d) => d.platforms[k].sales),
    })),
  ];
  const total = r2(parts.reduce((s, x) => s + x.value, 0));
  const shown = parts.filter((x) => x.value > 0);
  return (
    <Card title="Sales mix" sub="Where the sales came from">
      {total === 0 ? <Empty text="No sales in this period yet." /> : (
        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[150px_1fr] md:grid-cols-1 xl:grid-cols-[150px_1fr]">
          <div className="relative mx-auto h-[150px] w-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={shown} dataKey="value" nameKey="label" innerRadius={48} outerRadius={72} paddingAngle={shown.length > 1 ? 1.5 : 0} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                  {shown.map((x) => <Cell key={x.key} fill={x.colour} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [`${money(v)} · ${pct1(Number(v), total)}%`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div><span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Total</span><b style={heading} className="text-[16px] font-bold tabular-nums">{gbp(total)}</b></div>
            </div>
          </div>
          <table className="w-full text-[13px]">
            <tbody>
              {parts.map((x) => (
                <tr key={x.key} className="border-b border-[#F0EBDF] last:border-0">
                  <td className="py-1.5"><i className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: x.colour }} />{x.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{gbp2(x.value)}</td>
                  <td className="w-12 py-1.5 text-right tabular-nums text-muted-foreground">{pct1(x.value, total)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── 5. Delivery platforms with commission each ──────────────────────────────
export function PlatformsCard({ p }: { p: P }) {
  const rows = CARD_PLATFORMS.map((x) => ({ ...x, sales: sum(p.cur, (d) => d.platforms[x.key].sales), commission: sum(p.cur, (d) => d.platforms[x.key].commission) }));
  const sales = r2(rows.reduce((s, x) => s + x.sales, 0));
  const commission = r2(rows.reduce((s, x) => s + x.commission, 0));
  const top = Math.max(1, ...rows.map((x) => x.sales));
  const allSales = sum(p.cur, (d) => d.total);
  const pctPill = (c: number, s: number) => (s ? <span className="rounded-full bg-[#F3EEE3] px-2 py-0.5 text-[12px] font-semibold text-[#5B524B]">{pct1(c, s)}%</span> : "—");
  return (
    <Card title="Delivery platforms" sub="Sales and commission from each payout summary" className="md:col-span-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px] tabular-nums">
          <thead className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
            <tr>
              <th className="py-1.5 text-left font-semibold">Platform</th>
              <th className="w-[30%] py-1.5" />
              <th className="py-1.5 text-right font-semibold">Sales</th>
              <th className="py-1.5 text-right font-semibold">Commission</th>
              <th className="py-1.5 text-right font-semibold">Commission %</th>
              <th className="py-1.5 text-right font-semibold">You keep</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.key} className="border-t border-[#F0EBDF]">
                <td className="py-2"><i className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: CHANNEL_COLOUR[x.key] }} />{x.label}</td>
                <td className="px-2 py-2"><div className="h-2 rounded-full bg-[#F3EEE3]"><div className="h-full rounded-full" style={{ width: `${(x.sales / top) * 100}%`, background: CHANNEL_COLOUR[x.key] }} /></div></td>
                <td className="py-2 text-right">{gbp2(x.sales)}</td>
                <td className="py-2 text-right">{gbp2(x.commission)}</td>
                <td className="py-2 text-right">{pctPill(x.commission, x.sales)}</td>
                <td className="py-2 text-right">{gbp2(x.sales - x.commission)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-semibold">
            <tr className="border-t-2 border-[#ECE5D6]">
              <td className="py-2">All platforms</td><td />
              <td className="py-2 text-right">{gbp2(sales)}</td>
              <td className="py-2 text-right">{gbp2(commission)}</td>
              <td className="py-2 text-right">{pctPill(commission, sales)}</td>
              <td className="py-2 text-right">{gbp2(sales - commission)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Platforms are {pct1(sales, allSales)}% of sales this period. The highest commission % is the platform that costs most per £1 of sales.
      </p>
    </Card>
  );
}

// ── 6. Money out ────────────────────────────────────────────────────────────
const OUT_LINES = [
  ["Stock received", "stock"], ["Expenses", "expenses"], ["Card fee", "card_fee"],
  ["Till paid out", "paid_out"], ["Staff wages", "wages"], ["Platform commission", "commission"],
] as const;
export function MoneyOutCard({ p }: { p: P }) {
  const lines = OUT_LINES.map(([label, key]) => ({ label, value: sum(p.cur, (d) => d.out[key]) })).sort((a, b) => b.value - a.value);
  const total = r2(lines.reduce((s, l) => s + l.value, 0));
  const top = Math.max(1, ...lines.map((l) => l.value));
  const sales = sum(p.cur, (d) => d.total);
  return (
    <Card title="Money out" sub="Everything that went out, biggest first">
      <p style={heading} className="text-[28px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{gbp2(total)}</p>
      <p className="text-[12.5px] text-muted-foreground">{sales ? `${pct1(total, sales)}% of sales` : "No sales to compare"}</p>
      <div className="mt-3 flex flex-col gap-2.5">
        {lines.map((l) => (
          <div key={l.label} title={`${l.label}: ${gbp2(l.value)}`}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span>{l.label}</span>
              <span className="tabular-nums"><b className="font-semibold">{gbp2(l.value)}</b><span className="ml-2 inline-block w-11 text-right text-muted-foreground">{pct1(l.value, total)}%</span></span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-[#F3EEE3]"><div className="h-full rounded-full" style={{ width: `${(l.value / top) * 100}%`, background: COST }} /></div>
          </div>
        ))}
      </div>
      <p className="mt-3 rounded-xl bg-[#FBF8F1] px-3 py-2 text-[12px] text-muted-foreground">Expenses have the VAT you claim back taken off. Staff wages are hours × pay rate, so they show £0 for anyone without a pay rate.</p>
    </Card>
  );
}

// ── 7. Net total by day, with the running total ─────────────────────────────
export function NetByDayCard({ p }: { p: P }) {
  let running = 0;
  const lastIndex = p.soFar.length - 1;
  const data = p.cur.map((d, i) => {
    if (i <= lastIndex) running = r2(running + d.net);
    return { label: p.label(d.date), date: d.date, net: d.net, running: i <= lastIndex ? running : null, total: d.total, moneyOut: d.moneyOut };
  });
  const total = sum(p.cur, (d) => d.net);
  return (
    <Card title="Net total by day" sub="Sales ÷ 1.2 − money out · bars below the line lost money" className="md:col-span-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[12.5px] text-[#5B524B]">Period <b style={{ ...heading, color: total < 0 ? BAD : GOOD }} className="tabular-nums">{gbp2(total)}</b></span>
        <Legend items={[{ label: "Made money", colour: GOOD }, { label: "Lost money", colour: BAD }, { label: "Running total", colour: INK_2, line: true }]} />
      </div>
      <div className="mt-2 h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => gbp(v)} width={56} />
            <ReferenceLine y={0} stroke="#D9D0C1" />
            <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(0,0,0,0.03)" }}
              labelFormatter={(_l, items) => (items?.[0] ? dayName(items[0].payload.date) : "")}
              formatter={(v, n) => [money(v), n === "net" ? "Net total" : "Running total"]} />
            <Bar dataKey="net" maxBarSize={24} radius={[4, 4, 4, 4]}>
              {data.map((d) => <Cell key={d.date} fill={d.net < 0 ? BAD : GOOD} />)}
            </Bar>
            <Line type="monotone" dataKey="running" stroke={INK_2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── 8. Staff vs sales ───────────────────────────────────────────────────────
export function StaffCard({ p }: { p: P }) {
  const hours = sum(p.cur, (d) => d.hours);
  const wages = sum(p.cur, (d) => d.out.wages);
  const sales = sum(p.cur, (d) => d.total);
  const data = p.cur.map((d) => ({ label: p.label(d.date), date: d.date, hours: d.hours, total: d.total }));
  return (
    <Card title="Staff vs sales" sub="Clocked hours per day (Attendance) against sales" className="md:col-span-2 xl:col-span-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Hours" value={hoursMinutes(hours)} />
        <Stat label="Wages" value={gbp2(wages)} />
        <Stat label="Labour %" value={wages && sales ? `${pct1(wages, sales)}%` : "—"} />
        <Stat label="Sales per hour" value={hours ? gbp2(sales / hours) : "—"} />
      </div>
      <div className="mt-3 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)}h`} width={48} />
            <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(0,0,0,0.03)" }}
              labelFormatter={(_l, items) => (items?.[0] ? dayName(items[0].payload.date) : "")}
              formatter={(v, _n, item) => [`${hoursMinutes(Number(v))}${item.payload.total ? ` · sales ${gbp2(item.payload.total)}` : ""}`, "Worked"]} />
            <Bar dataKey="hours" fill={HOURS} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!wages && hours > 0 && <p className="mt-2 text-[12px] text-muted-foreground">No pay rates yet, so this shows hours. Wages and labour % appear once rates are added in Staff Hub → Staff.</p>}
    </Card>
  );
}

// ── 9. Cash check ───────────────────────────────────────────────────────────
export function CashCheckCard({ p }: { p: P }) {
  const card = sum(p.cur, (d) => d.card), cash = sum(p.cur, (d) => d.cash), bankIn = sum(p.cur, (d) => d.bankIn), tips = sum(p.cur, (d) => d.tips);
  const days = p.cur.filter((d) => d.variance != null);
  const top = Math.max(1, ...days.map((d) => Math.abs(d.variance!)));
  const taken = card + cash;
  return (
    <Card title="Cash check" sub="From the Daily accounts sheets">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Card" value={gbp2(card)} />
        <Stat label="Cash" value={gbp2(cash)} />
        <Stat label="Not banked" value={gbp2(cash - bankIn)} />
        <Stat label="Tips" value={gbp2(tips)} />
      </div>
      {taken > 0 && (
        <div className="mt-3">
          <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-full">
            <div title={`Card ${gbp2(card)}`} style={{ width: `${(card / taken) * 100}%`, background: CHANNEL_COLOUR.dine_in }} />
            <div title={`Cash ${gbp2(cash)}`} style={{ width: `${(cash / taken) * 100}%`, background: CHANNEL_COLOUR.just_eat }} />
          </div>
          <div className="mt-1.5"><Legend items={[{ label: `Card ${Math.round((card / taken) * 100)}%`, colour: CHANNEL_COLOUR.dine_in }, { label: `Cash ${Math.round((cash / taken) * 100)}%`, colour: CHANNEL_COLOUR.just_eat }]} /></div>
        </div>
      )}
      <p className="mb-1.5 mt-3 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Variance · closing − opening</p>
      {days.length === 0 ? <Empty text="No opening / closing cash entered in this period." /> : (
        <div className="flex flex-col gap-1.5">
          {days.map((d) => (
            <div key={d.date} className="grid grid-cols-[5.5em_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px] tabular-nums" title={`${dayName(d.date)}: ${gbp2(d.variance!)}`}>
              <span>{dayName(d.date, { weekday: "short", day: "numeric" })}</span>
              <div className="relative h-2.5">
                <div className="absolute inset-y-[-2px] left-1/2 w-px bg-[#D9D0C1]" />
                <div className="absolute inset-y-0 rounded" style={{ [d.variance! >= 0 ? "left" : "right"]: "50%", width: `${(Math.abs(d.variance!) / top) * 50}%`, background: d.variance! >= 0 ? GOOD : BAD }} />
              </div>
              <b className="font-semibold" style={{ color: d.variance! < 0 ? BAD : undefined }}>{gbp2(d.variance!)}</b>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl bg-[#FBF8F1] px-3 py-7 text-center text-[13px] text-muted-foreground">{text}</p>;
}

function addDays(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
