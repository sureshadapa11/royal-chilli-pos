"use client";

import { useEffect, useState } from "react";
import type { ExtraCards as Data } from "@/lib/dashboard-extra";
import type { RangeKey } from "@/lib/admin-dashboard";
import { Card, gbp, gbp2, heading } from "@/components/staff/dashboard-kit";
import { hoursMinutes } from "@/lib/utils";

// The dashboard's newer cards (agreed mock-up 2026-10-12): target, Day End
// streak, sales per staff hour, sales calendar, best weekdays, how customers
// paid, platform commission, staff hours — and for Super admin / Supervisor
// cash health, where the cash went, VAT so far, money owed. All from hand-
// entered data, so they work without the till.

const RED = "#e34435", RED_SOFT = "#f6a399", GREEN = "#1f8a4c", PINK = "#f6b3aa", AMBER = "#d97706", SOFT = "#f6f1e6";
const PLATFORM_COLOUR: Record<string, string> = { just_eat: "#f97316", deliveroo: "#14b8a6", uber_eats: "#111827", hiest: "#a855f7" };
const DONUT = ["#16a34a", "#2563eb", "#db2777", "#f59e0b", "#7c3aed", "#0f9d8a", "#94a3b8"];
const dayName = (d: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
const Tag = ({ owner }: { owner?: boolean }) => (
  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${owner ? "bg-[#fdecea] text-[#b91c1c]" : "bg-[#e8f2ff] text-[#1d4ed8]"}`}>{owner ? "You" : "All"}</span>
);
const Big = ({ children }: { children: React.ReactNode }) => <p style={heading} className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em]">{children}</p>;

/** A donut from slices (SVG, no library). */
function Donut({ slices, centre, sub }: { slices: { value: number; colour: string }[]; centre: string; sub: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 25;
  return (
    <svg width="116" height="116" viewBox="0 0 42 42" className="shrink-0">
      <circle cx="21" cy="21" r="15.9" fill="none" stroke={SOFT} strokeWidth="6" />
      {slices.filter((s) => s.value > 0).map((s, i) => {
        const pct = (s.value / total) * 100;
        const el = <circle key={i} cx="21" cy="21" r="15.9" fill="none" stroke={s.colour} strokeWidth="6" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset} />;
        offset -= pct;
        return el;
      })}
      <text x="21" y="22.4" textAnchor="middle" fontSize="5.2" fontWeight="700" fill="currentColor">{centre}</text>
      <text x="21" y="27" textAnchor="middle" fontSize="2.6" fill="currentColor" opacity=".6">{sub}</text>
    </svg>
  );
}

function HBars({ rows }: { rows: { label: string; value: number; text: string; colour: string }[] }) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="mt-2 space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[86px_1fr_78px] items-center gap-2 text-[12.5px]">
          <span className="truncate text-[#5B524B]">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-[#f6f1e6]"><span className="block h-full rounded-full" style={{ width: `${(r.value / top) * 100}%`, background: r.colour }} /></span>
          <span className="text-right font-semibold tabular-nums">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function ExtraCards({ range }: { range: RangeKey }) {
  const [d, setD] = useState<(Data & { canSetTarget: boolean; allBusinesses?: boolean }) | null>(null);
  const [error, setError] = useState(false);
  const load = () => fetch(`/api/staff/dashboard-extra?range=${range}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setD).catch(() => setError(true));
  useEffect(() => { setError(false); load(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="text-[13px] text-[#C0392B]">Couldn&apos;t load the newer cards.</p>;
  if (!d) return <p className="text-[13px] text-muted-foreground">Loading more cards…</p>;
  if (d.allBusinesses) return <p className="text-[13px] text-muted-foreground">Pick one business to see its target, calendar, streak and cash cards.</p>;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <TargetCard d={d} onSaved={load} />
      <StreakCard d={d} />
      <PerHourCard d={d} />
      <CalendarCard d={d} />
      <WeekdaysCard d={d} />
      <PaidCard d={d} />
      <CommissionCard d={d} />
      <StaffHoursCard d={d} />
      {d.money && <CashHealthCard d={d} />}
      {d.money && <WhereCashCard d={d} />}
      {d.money && <VatCard d={d} />}
      {d.money && <OwedCard d={d} />}
    </div>
  );
}

type D = Data & { canSetTarget: boolean };

function TargetCard({ d, onSaved }: { d: D; onSaved: () => void }) {
  const t = d.target;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(t.target ? String(t.target) : "");
  const monthLabel = new Date(`${t.month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const pct = t.target ? Math.min(100, (t.sales / t.target) * 100) : 0;
  const timePct = (t.daysGone / t.daysInMonth) * 100;
  const left = t.daysInMonth - t.daysGone;
  const perDay = t.target && left > 0 ? Math.max(0, (t.target - t.sales) / left) : 0;
  async function save() {
    const n = Number(value);
    if (!(n >= 0)) return;
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monthly_sales_target: n }) });
    setEditing(false);
    onSaved();
  }
  return (
    <Card title={`🎯 ${monthLabel} target`} sub="Sales towards your monthly target" action={<Tag />}>
      {t.target && !editing ? (
        <>
          <Big>{gbp(t.sales)} <span className="text-[13px] font-normal text-muted-foreground">of {gbp(t.target)}</span></Big>
          <div className="relative mt-3 h-3.5 overflow-hidden rounded-full bg-[#f6f1e6]">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${RED}, #f59e0b)` }} />
            <span className="absolute -inset-y-1 w-0.5 bg-[#201B18] opacity-50" style={{ left: `${timePct}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {Math.round(pct)}% done · {t.daysGone} of {t.daysInMonth} days gone (line){left > 0 && t.sales < t.target ? <> · need <b className="text-foreground">{gbp(perDay)}/day</b> to hit it</> : t.sales >= t.target ? " · 🎉 target reached" : ""}
          </p>
          {d.canSetTarget && <button onClick={() => setEditing(true)} className="mt-2 text-[12px] font-semibold text-[#2563eb] hover:underline">Change target</button>}
        </>
      ) : d.canSetTarget ? (
        <div className="mt-2">
          <p className="text-[13px] text-muted-foreground">{t.target ? "New monthly target:" : `Set a monthly sales target. ${monthLabel} so far: ${gbp(t.sales)}.`}</p>
          <div className="mt-2 flex gap-2">
            <span className="flex flex-1 items-center rounded-lg border border-border px-2"><span className="text-muted-foreground">£</span>
              <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="30000" className="w-full bg-transparent px-1 py-2 text-[14px] outline-none" /></span>
            <button onClick={save} className="rounded-lg bg-[#e34435] px-4 text-[13px] font-semibold text-white">Save</button>
          </div>
        </div>
      ) : (
        <><Big>{gbp(t.sales)}</Big><p className="text-[12.5px] text-muted-foreground">No target set yet (Super admin sets it).</p></>
      )}
    </Card>
  );
}

function StreakCard({ d }: { d: D }) {
  const s = d.streak;
  return (
    <Card title="✅ Day End streak" sub="Last 14 days" action={<Tag />}>
      <div className="flex items-center justify-between">
        <Big>{s.current} day{s.current === 1 ? "" : "s"} <span className="text-[13px] font-normal text-muted-foreground">in a row</span></Big>
        {s.current >= 3 && <span className="text-[26px]">🔥</span>}
      </div>
      <div className="mt-3 grid grid-cols-[repeat(14,1fr)] gap-1.5">
        {s.days.map((x) => <span key={x.date} title={`${dayName(x.date)} · ${x.entered ? "entered" : "missing"}`} className="aspect-square rounded-full" style={{ background: x.entered ? GREEN : PINK }} />)}
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        {s.days.length - s.missing.length} entered{s.missing.length ? <> · <b className="text-[#C0392B]">{s.missing.length} missing</b> ({s.missing.map((x) => dayName(x, { weekday: "short", day: "numeric" })).join(", ")})</> : " · none missing 🎉"}
      </p>
    </Card>
  );
}

function PerHourCard({ d }: { d: D }) {
  const p = d.perHour;
  const pts = p.series.filter((x) => x.value != null) as { date: string; value: number }[];
  const max = Math.max(1, ...pts.map((x) => x.value)), min = Math.min(...pts.map((x) => x.value), max);
  const line = pts.map((x, i) => `${(i / Math.max(1, pts.length - 1)) * 260},${52 - ((x.value - min) / Math.max(1, max - min)) * 44}`).join(" ");
  const change = p.value != null && p.prevValue != null ? p.value - p.prevValue : null;
  return (
    <Card title="⏱️ Sales per staff hour" sub="Sales ÷ hours worked" action={<Tag />}>
      <Big>{p.value != null ? gbp2(p.value) : "—"}</Big>
      <p className="text-[12.5px] text-muted-foreground">
        {change != null && <span className={`font-semibold ${change >= 0 ? "text-[#1f8a4c]" : "text-[#C0392B]"}`}>{change >= 0 ? "▲" : "▼"} {gbp2(Math.abs(change))} </span>}
        {change != null ? "vs the period before · " : ""}{hoursMinutes(p.seconds / 3600)} worked
      </p>
      {pts.length > 1 && (
        <svg viewBox="0 0 260 60" width="100%" height="60" className="mt-1.5">
          <polyline fill="rgba(227,68,53,.08)" stroke="none" points={`0,60 ${line} 260,60`} />
          <polyline fill="none" stroke={RED} strokeWidth="2.5" strokeLinejoin="round" points={line} />
        </svg>
      )}
    </Card>
  );
}

function CalendarCard({ d }: { d: D }) {
  const c = d.calendar;
  const vals = c.days.map((x) => x.sales ?? 0);
  const max = Math.max(1, ...vals);
  const lead = (new Date(`${c.month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() - 5 * 3600_000));
  const shade = (v: number) => { const t = v / max; return `rgba(227,68,53,${0.15 + t * 0.85})`; };
  const monthLabel = new Date(`${c.month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return (
    <Card title="📅 Sales calendar" sub={`${monthLabel} · darker = busier · striped = no Day End`} action={<Tag />} className="md:col-span-2">
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="text-center text-[10.5px] font-semibold text-muted-foreground">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {c.days.map((x) => {
          const future = x.date > today;
          const missing = !future && x.sales == null;
          const dark = (x.sales ?? 0) / max > 0.55;
          return (
            <a key={x.date} href={future ? undefined : `/staff/daily-accounts?date=${x.date}`} title={`${dayName(x.date)}${x.sales != null ? ` · ${gbp2(x.sales)}` : future ? "" : " · no Day End"}`}
              className={`flex aspect-[1.25] flex-col justify-between rounded-lg px-1.5 py-1 text-[10px] ${future ? "border border-[#ECE5D6]" : missing ? "border border-dashed border-[#ECE5D6] text-muted-foreground" : ""}`}
              style={missing ? { background: "repeating-linear-gradient(45deg,#f6f1e6,#f6f1e6 4px,transparent 4px,transparent 8px)" } : !future ? { background: shade(x.sales ?? 0), color: dark ? "#fff" : "#3b2a1f" } : undefined}>
              <b className="font-semibold">{Number(x.date.slice(8))}</b>
              <span className="text-right opacity-90">{x.sales != null ? gbp(x.sales) : x.date === today ? "today" : ""}</span>
            </a>
          );
        })}
      </div>
      {c.best && <p className="mt-2 text-[12.5px] text-muted-foreground">Best day: <b className="text-foreground">{dayName(c.best.date)} · {gbp2(c.best.sales)}</b> · tap a day to open its Daily accounts</p>}
    </Card>
  );
}

function WeekdaysCard({ d }: { d: D }) {
  const w = d.weekdays;
  const vals = w.filter((x) => x.avg != null) as { label: string; avg: number }[];
  const max = Math.max(1, ...vals.map((x) => x.avg));
  const best = vals.length ? vals.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const worst = vals.length ? vals.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
  return (
    <Card title="📊 Best days of the week" sub="Average sales, last 8 weeks" action={<Tag />}>
      <div className="mt-3 flex h-[130px] items-end gap-2">
        {w.map((x) => (
          <div key={x.label} className="flex flex-1 flex-col items-center gap-1 text-[11px] text-muted-foreground" title={x.avg != null ? `${x.label}: avg ${gbp2(x.avg)} over ${x.count} day${x.count === 1 ? "" : "s"}` : `${x.label}: no days yet`}>
            <span className="w-full rounded-t-lg rounded-b" style={{ height: `${x.avg ? Math.max(4, (x.avg / max) * 110) : 3}px`, background: best && x.label === best.label ? RED : RED_SOFT }} />
            <span className={best && x.label === best.label ? "font-bold text-foreground" : ""}>{x.label}</span>
          </div>
        ))}
      </div>
      {best && worst && <p className="mt-1.5 text-[12.5px] text-muted-foreground"><b className="text-foreground">{best.label}</b> is your best day (avg <b className="text-foreground">{gbp(best.avg)}</b>) · {worst.label} the quietest ({gbp(worst.avg)})</p>}
    </Card>
  );
}

function PaidCard({ d }: { d: D }) {
  const p = d.paid;
  const total = p.card + p.cash + p.delivery;
  const rows = [{ label: "Card", value: p.card, colour: "#2563eb" }, { label: "Cash", value: p.cash, colour: "#0f9d8a" }, { label: "Delivery apps", value: p.delivery, colour: "#f59e0b" }];
  const top = rows.reduce((a, b) => (b.value > a.value ? b : a));
  return (
    <Card title="💳 How customers paid" sub="From the Day Ends" action={<Tag />}>
      {total > 0 ? (
        <div className="mt-2 flex items-center gap-4">
          <Donut slices={rows.map((r) => ({ value: r.value, colour: r.colour }))} centre={`${Math.round((top.value / total) * 100)}%`} sub={top.label.toLowerCase()} />
          <div className="grid gap-1.5 text-[12.5px]">
            {rows.map((r) => <div key={r.label} className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: r.colour }} />{r.label} · {gbp(r.value)}</div>)}
          </div>
        </div>
      ) : <p className="mt-2 text-[13px] text-muted-foreground">No Day End figures in this period yet.</p>}
    </Card>
  );
}

function CommissionCard({ d }: { d: D }) {
  const rows = d.commission.filter((c) => c.sales > 0);
  const totalC = d.commission.reduce((s, c) => s + c.commission, 0);
  const totalS = d.commission.reduce((s, c) => s + c.sales, 0);
  return (
    <Card title="🛵 Platform commission" sub="Real % each app takes" action={<Tag />}>
      {rows.length ? (
        <>
          <HBars rows={rows.map((c) => ({ label: c.label, value: c.pct ?? 0, text: c.pct != null ? `${c.pct.toFixed(1)}%` : "not entered", colour: PLATFORM_COLOUR[c.key] ?? "#94a3b8" }))} />
          <p className="mt-2 text-[12.5px] text-muted-foreground">{totalC > 0 ? `${gbp2(totalC)} commission on ${gbp(totalS)} of delivery sales` : `${gbp(totalS)} of delivery sales · commission not entered yet`}</p>
        </>
      ) : <p className="mt-2 text-[13px] text-muted-foreground">No delivery sales in this period.</p>}
    </Card>
  );
}

function StaffHoursCard({ d }: { d: D }) {
  const rows = d.staffHours.slice(0, 8);
  const total = d.staffHours.reduce((s, x) => s + x.seconds, 0);
  return (
    <Card title="👥 Staff hours" sub="Hours only" action={<Tag />}>
      {rows.length ? (
        <>
          <HBars rows={rows.map((x) => ({ label: x.name, value: x.seconds, text: hoursMinutes(x.seconds / 3600), colour: RED }))} />
          <p className="mt-2 text-[12.5px] text-muted-foreground">{d.staffHours.length} people · {hoursMinutes(total / 3600)}{d.stillIn ? ` · ⚠️ ${d.stillIn} still clocked in` : ""}</p>
        </>
      ) : <p className="mt-2 text-[13px] text-muted-foreground">Nobody clocked in this period.</p>}
    </Card>
  );
}

function CashHealthCard({ d }: { d: D }) {
  const m = d.money!;
  const max = Math.max(1, ...m.varianceByDay.map((x) => Math.abs(x.variance)));
  return (
    <Card title="💰 Cash health" sub="From the Cash book" action={<Tag owner />}>
      <Big>{m.cashNow != null ? gbp2(m.cashNow) : "—"} <span className="text-[13px] font-normal text-muted-foreground">in the drawer</span></Big>
      <p className="text-[12.5px] text-muted-foreground">
        Variance {m.variance == null ? "—" : <b className={Math.abs(m.variance) < 0.005 ? "text-[#1f8a4c]" : "text-[#C0392B]"}>{m.variance > 0 ? "+" : ""}{gbp2(m.variance)}</b>} · {m.daysOff} day{m.daysOff === 1 ? "" : "s"} off
      </p>
      {m.varianceByDay.length > 0 && (
        <div className="mt-2 flex h-[64px] items-center gap-1">
          {m.varianceByDay.map((x) => {
            const h = Math.max(2, (Math.abs(x.variance) / max) * 28);
            return (
              <div key={x.date} className="relative flex h-full flex-1 items-center" title={`${dayName(x.date)}: ${x.variance > 0 ? "+" : ""}${gbp2(x.variance)}`}>
                <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-[#ECE5D6]" />
                <span className="absolute inset-x-[15%] rounded" style={{ height: h, background: x.variance < -0.005 ? RED : GREEN, ...(x.variance < 0 ? { top: "50%" } : { bottom: "50%" }) }} />
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">Each bar = a day · red = missing, green = extra</p>
    </Card>
  );
}

function WhereCashCard({ d }: { d: D }) {
  const rows = d.money!.cashOut;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const shown = rows.slice(0, 6);
  const other = rows.slice(6).reduce((s, r) => s + r.amount, 0);
  const slices = [...shown.map((r, i) => ({ ...r, colour: DONUT[i] })), ...(other ? [{ label: "Other", amount: other, colour: DONUT[6] }] : [])];
  return (
    <Card title="🍩 Where the cash went" sub="Cash Money OUT by category" action={<Tag owner />}>
      {total > 0 ? (
        <div className="mt-2 flex items-center gap-4">
          <Donut slices={slices.map((s) => ({ value: s.amount, colour: s.colour }))} centre={gbp(total)} sub="out" />
          <div className="grid gap-1.5 text-[12.5px]">
            {slices.map((s) => <div key={s.label} className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.colour }} />{s.label} · {gbp(s.amount)}</div>)}
          </div>
        </div>
      ) : <p className="mt-2 text-[13px] text-muted-foreground">No cash paid out in this period.</p>}
    </Card>
  );
}

function VatCard({ d }: { d: D }) {
  const v = d.money!.vat;
  const tile = (l: string, val: string, red?: boolean) => (
    <div className="rounded-xl bg-[#f6f1e6] px-2.5 py-2"><div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">{l}</div><div style={heading} className={`mt-0.5 text-[17px] font-bold ${red ? "text-[#C0392B]" : ""}`}>{val}</div></div>
  );
  return (
    <Card title="🏛️ VAT so far" sub="This period · sales ÷ 1.2" action={<Tag owner />}>
      <div className="mt-2 grid grid-cols-3 gap-2">{tile("Sales VAT", gbp(v.sales))}{tile("Claimed back", gbp(v.claimed))}{tile("To pay", gbp(v.toPay), true)}</div>
      <p className="mt-3 rounded-xl bg-[#f6f1e6] px-3 py-2 text-[12.5px] text-muted-foreground">📆 This quarter so far: <b className="text-foreground">{gbp(v.quarterToPay)}</b> to put aside</p>
    </Card>
  );
}

function OwedCard({ d }: { d: D }) {
  const o = d.money!.owed;
  const total = o.pending + o.catering;
  return (
    <Card title="⏳ Money owed to us" sub={o.asOf ? `As of ${dayName(o.asOf)}` : "From the Day Ends"} action={<Tag owner />}>
      <Big>{gbp2(total)}</Big>
      <HBars rows={[{ label: "Pending bills", value: o.pending, text: gbp(o.pending), colour: AMBER }, { label: "Catering & events", value: o.catering, text: gbp(o.catering), colour: AMBER }]} />
      {o.jobs.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-dashed border-[#ECE5D6] pt-2 text-[12.5px]">
          {o.jobs.slice(0, 5).map((j, i) => (
            <div key={i} className="flex justify-between gap-2"><span className="truncate">{j.kind === "event" ? "🎉" : j.kind === "bill" ? "🧾" : "🍱"} {j.customer} <span className="text-muted-foreground">· {dayName(j.date, { day: "numeric", month: "short" })}</span></span><b className="tabular-nums">{gbp2(j.owed)}</b></div>
          ))}
          {o.jobs.length > 5 && <p className="text-muted-foreground">+{o.jobs.length - 5} more in Daily accounts</p>}
        </div>
      )}
    </Card>
  );
}
