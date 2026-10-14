"use client";

import { useCallback, useEffect, useState } from "react";
import WhatsAppReportButton from "@/components/staff/WhatsAppReportButton";
import { useToast } from "@/hooks/use-toast";
import { DAILY_FIELDS, platformCommission, type DailyFieldKey, type DailyValues, cashCheck, PLATFORM_COMMISSION } from "@/lib/daily-accounts-fields";

// Staff Hub → Daily accounts: the manager's day-end sheet (the paper "Daily
// Accounts Report"). Till figures come pre-filled and stay editable; bank in,
// catering and notes are typed in. Save as a draft, or Submit — after which
// only an admin or the owner can change it.

const niceDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const gbp = (n: number) => `£${n.toFixed(2)}`;
const toText = (n: number | null | undefined) => (n == null ? "" : String(Number(n)));

// The day form in groups, three across on a computer (agreed 2026-10-13):
// takings, the cash drawer (with its live check), delivery platforms as a
// small table, catering. Same boxes as before (Takeaway stays hidden).
const TAKINGS: DailyFieldKey[] = ["z_report", "card", "cash", "tips", "pending", "commission"];
const DRAWER: DailyFieldKey[] = ["opening_balance", "bank_in", "closing_balance"];
const CATERING: DailyFieldKey[] = ["catering_paid", "catering_pending"];
const PLATFORMS: { key: keyof typeof PLATFORM_COMMISSION; label: string }[] = [
  { key: "just_eat", label: "Just Eat" }, { key: "deliveroo", label: "Deliveroo" },
  { key: "uber_eats", label: "Uber Eats" }, { key: "hiest", label: "Hiest" },
];
const FIELD = Object.fromEntries(DAILY_FIELDS.map((f) => [f.key, f])) as Record<DailyFieldKey, (typeof DAILY_FIELDS)[number]>;
const LABEL: Partial<Record<DailyFieldKey, string>> = { opening_balance: "Opening", closing_balance: "Closing (counted)", pending: "Bills owed" };

type Saved = (Partial<DailyValues> & { notes: string | null; status: "draft" | "submitted"; submitted_at: string | null }) | null;
type JobPay = { kind: string; customer: string; amount: number; method: string };
type Day = { saved: Saved; till: DailyValues; cardFeeRate: number; jobPayments?: JobPay[]; billsOwed?: number; cashMoves?: { moneyIn: number; moneyOut: number } | null; locked: boolean; canUnlock: boolean; viewOnly?: boolean };

// seeFigures: Super admin / Supervisor see the cash check and WhatsApp; Managers only enter.
export default function DailyAccountsView({ today, start, seeFigures = false }: { today: string; start: string; seeFigures?: boolean }) {
  const { toast } = useToast();
  const [date, setDate] = useState(start);
  const [day, setDay] = useState<Day | null>(null);
  const [values, setValues] = useState<Record<DailyFieldKey, string>>({} as Record<DailyFieldKey, string>);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<null | "save" | "submit">(null);
  const [help, setHelp] = useState<DailyFieldKey | null>(null);

  const load = useCallback(async () => {
    setDay(null);
    const res = await fetch(`/api/staff/daily-accounts?date=${date}`);
    if (!res.ok) return toast({ title: "Couldn't load the day", variant: "destructive" });
    const d: Day = await res.json();
    setDay(d);
    // A saved sheet shows what was saved; a new day starts from the till's figures.
    setValues(Object.fromEntries(DAILY_FIELDS.map((f) => [f.key, toText(d.saved ? d.saved[f.key] : d.till[f.key])])) as Record<DailyFieldKey, string>);
    setNotes(d.saved?.notes ?? "");
  }, [date, toast]);
  useEffect(() => { load(); }, [load]);

  async function save(submit: boolean) {
    setBusy(submit ? "submit" : "save");
    const res = await fetch("/api/staff/daily-accounts", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, values, notes, submit }),
    });
    setBusy(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast({ title: "Not saved", description: d.error ?? "Please try again", variant: "destructive" });
    toast({ title: submit ? `Submitted ${niceDate(date)}` : `Saved ${niceDate(date)} as a draft` });
    load();
  }

  const status = day?.saved?.status;
  const locked = !!day?.locked;
  const input = "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-right text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-red-600/30 disabled:opacity-70";

  return (
        <div className="rounded-[14px] border border-border bg-surface p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-[13px] font-medium text-muted-foreground" htmlFor="da-date">Day</label>
            <input id="da-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[14px]" />
            <span className="text-[13px] text-muted-foreground">{niceDate(date)}</span>
            <span className="ml-auto">{seeFigures && <WhatsAppReportButton date={date} />}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
              status === "submitted" ? "bg-emerald-100 text-emerald-800" : status === "draft" ? "bg-amber-100 text-amber-800" : "bg-[#F6F1E6] text-muted-foreground"
            }`}>
              {status === "submitted" ? "Submitted" : status === "draft" ? "Draft" : "Not entered yet"}
            </span>
          </div>

          {locked && (
            <p className="mb-3 rounded-lg bg-[#F6F1E6] px-3 py-2 text-[13px] text-muted-foreground">
              {day?.viewOnly ? "View only: you can see this day but not change it." : "This day has been submitted. Ask a Super admin if something needs changing."}
            </p>
          )}

          {!day ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              {(() => {
                const set = (k: DailyFieldKey, v: string) => setValues((x) => ({ ...x, [k]: v.replace(/[^0-9.]/g, "") }));
                // One box: label, ⓘ for its help (tap or hover), the till's figure, the input.
                const box = (k: DailyFieldKey) => {
                  const f = FIELD[k];
                  const head = (right: string) => (
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="flex items-baseline gap-1">
                        <span className="text-[13.5px] font-semibold">{LABEL[k] ?? f.label}</span>
                        <button type="button" onClick={() => setHelp(help === k ? null : k)} title={f.hint} aria-label={`About ${f.label}`}
                          className="text-[12px] leading-none text-muted-foreground hover:text-foreground">ⓘ</button>
                      </span>
                      <span className="text-[11.5px] text-muted-foreground">{right}</span>
                    </span>
                  );
                  if (k === "pending" && !Number(values.pending || 0)) {
                    // From the Pending bills list (134): what's still owed at the end of this day.
                    return (
                      <div key={k}>
                        {head("Pending bills tab")}
                        <output className={`${input} mt-1 block bg-[#F6F1E6]`}>£{(day.billsOwed ?? 0).toFixed(2)}</output>
                        {help === k && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">Bills still owed at the end of this day. Add or settle them in the Pending bills tab.</span>}
                      </div>
                    );
                  }
                  if (k === "commission") {
                    // Worked out from the platform commissions + the card fee, never typed.
                    const platforms = platformCommission(values) ?? 0;
                    const cardFee = Math.round(Number(values.card || 0) * day.cardFeeRate * 100) / 100;
                    return (
                      <div key={k}>
                        {head("Worked out")}
                        <output className={`${input} mt-1 block bg-[#F6F1E6]`} aria-live="polite">£{(platforms + cardFee).toFixed(2)}</output>
                        {help === k && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">Platforms {gbp(platforms)} + card fee {gbp(cardFee)} ({Math.round(day.cardFeeRate * 10000) / 100}% of card)</span>}
                      </div>
                    );
                  }
                  const till = day.till[k];
                  const differs = f.auto && till != null && values[k] !== "" && Number(values[k]) !== Number(till);
                  return (
                    <label key={k} className="block">
                      {head(f.auto ? (till != null ? `Till: ${gbp(till)}` : "") : "")}
                      <span className="mt-1 flex items-center gap-1.5">
                        <input className={input} inputMode="decimal" disabled={locked} placeholder="£0.00" value={values[k] ?? ""}
                          onChange={(e) => set(k, e.target.value)} />
                        {differs && !locked && (
                          <button type="button" title={`Use the till's figure (${gbp(till!)})`} onClick={() => setValues((v) => ({ ...v, [k]: toText(till) }))}
                            className="rounded-md border border-border px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-hover">↺</button>
                        )}
                      </span>
                      {help === k && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{f.hint}</span>}
                    </label>
                  );
                };
                const group = (title: string, children: React.ReactNode) => (
                  <section className="mt-4 first:mt-0">
                    <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</h3>
                    {children}
                  </section>
                );
                const grid = "grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 md:grid-cols-3";
                const cell = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-right text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-red-600/30 disabled:opacity-70";
                return (
                  <>
                    {group("Takings", <div className={grid}>{TAKINGS.map(box)}</div>)}
                    {group("Cash drawer", <>
                      <div className={grid}>{DRAWER.map(box)}</div>
                      {seeFigures && <CashCheckLine values={values} moves={day.cashMoves ?? undefined} />}
                    </>)}
                    {group("Delivery platforms", (
                      <div className="grid grid-cols-[minmax(80px,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] items-center gap-x-3 gap-y-2 md:max-w-[620px]">
                        <span />
                        <span className="text-[11.5px] font-semibold text-muted-foreground">Sales</span>
                        <span className="text-[11.5px] font-semibold text-muted-foreground">Commission</span>
                        {PLATFORMS.map((pl) => (
                          <div key={pl.key} className="contents">
                            <span className="text-[13.5px] font-semibold">{pl.label}</span>
                            <input aria-label={`${pl.label} sales`} className={cell} inputMode="decimal" disabled={locked} placeholder="£0.00"
                              value={values[pl.key] ?? ""} onChange={(e) => set(pl.key, e.target.value)} />
                            <input aria-label={`${pl.label} commission`} className={cell} inputMode="decimal" disabled={locked} placeholder="£0.00"
                              value={values[PLATFORM_COMMISSION[pl.key]] ?? ""} onChange={(e) => set(PLATFORM_COMMISSION[pl.key], e.target.value)} />
                          </div>
                        ))}
                      </div>
                    ))}
                    {group("Catering & events", (() => {
                      // From the Catering & events tab (133): read-only here. Days entered
                      // before it keep their typed catering boxes.
                      const pays = day.jobPayments ?? [];
                      const legacy = CATERING.some((k) => Number(values[k] || 0) !== 0);
                      const sales = (kind: string) => pays.filter((p) => p.kind === kind && p.method !== "card").reduce((t, p) => t + p.amount, 0);
                      return (
                        <>
                          {pays.length === 0 ? (
                            <p className="text-[13px] text-muted-foreground">No catering or event payments this day. Jobs and their payments are in the <b>Catering &amp; events</b> tab.</p>
                          ) : (
                            <div className="space-y-1 text-[13.5px]">
                              {pays.map((p, i) => (
                                <div key={i} className="flex flex-wrap justify-between gap-2">
                                  <span>{p.kind === "event" ? "🎉" : "🍱"} {p.customer} <span className="text-muted-foreground">· {p.method === "card" ? "card (in Z report)" : p.method === "bank" ? "bank transfer" : "cash"}</span></span>
                                  <b className="tabular-nums">{gbp(p.amount)}</b>
                                </div>
                              ))}
                              <p className="pt-1 text-[12.5px] text-muted-foreground">Added to sales: catering {gbp(sales("catering"))} · events {gbp(sales("event"))}</p>
                            </div>
                          )}
                          {legacy && <div className={`${grid} mt-3`}>{CATERING.map(box)}</div>}
                        </>
                      );
                    })())}
                  </>
                );
              })()}

              <label className="mt-4 block">
                <span className="text-[13.5px] font-semibold">Notes</span>
                <textarea rows={3} maxLength={1000} disabled={locked} value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-600/30 disabled:opacity-70" />
              </label>

              {!locked && (
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {status !== "submitted" && (
                    <button onClick={() => save(false)} disabled={!!busy}
                      className="rounded-lg border border-border px-5 py-2.5 text-[14px] font-semibold hover:bg-surface-hover disabled:opacity-60">
                      {busy === "save" ? "Saving…" : "Save draft"}
                    </button>
                  )}
                  <button onClick={() => save(true)} disabled={!!busy}
                    className="rounded-lg bg-red-600 px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                    {busy === "submit" ? "Saving…" : status === "submitted" ? "Save correction" : "Submit day"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
  );
}

// The cash drawer check, worked out live as figures are typed (cashCheck in
// lib/daily-accounts-fields.ts — the same sum as the month sheet and email),
// shown as one line under the drawer boxes.
function CashCheckLine({ values, moves }: { values: Record<string, string>; moves?: { moneyIn: number; moneyOut: number } }) {
  const n = (k: string) => (values[k] === "" || values[k] == null ? null : Number(values[k]));
  const m = moves ?? { moneyIn: 0, moneyOut: 0 };
  const c = cashCheck({ opening: n("opening_balance"), cash: n("cash") ?? 0, moneyIn: m.moneyIn, moneyOut: m.moneyOut, bankIn: n("bank_in") ?? 0, counted: n("closing_balance") });
  const g = (v: number | null) => (v == null ? "—" : `£${v.toFixed(2)}`);
  const off = c.variance != null && Math.abs(c.variance) >= 0.005;
  const tile = (label: string, value: string, tone = "") => (
    <div className="rounded-lg bg-[#FBF8F1] px-3 py-1.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className={`text-[14px] font-semibold tabular-nums ${tone}`}>{value}</div></div>
  );
  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-2">
        {tile("Expected", g(c.expected))}
        {tile("Counted", g(n("closing_balance")))}
        {tile(off ? (c.variance! < 0 ? "Variance (missing)" : "Variance (extra)") : "Variance",
          c.variance == null ? "—" : `${c.variance > 0 ? "+" : c.variance < 0 ? "−" : ""}£${Math.abs(c.variance).toFixed(2)}`,
          c.variance == null ? "" : off ? "text-red-700" : "text-emerald-700")}
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Opening {g(n("opening_balance"))} + cash sales {g(n("cash") ?? 0)} + money in {g(m.moneyIn)} − money out {g(m.moneyOut)} − bank in {g(n("bank_in") ?? 0)}
      </p>
    </div>
  );
}
