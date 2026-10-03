"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { DAILY_FIELDS, type DailyFieldKey, type DailyValues } from "@/lib/daily-accounts-fields";

// Staff Hub → Daily accounts: the manager's day-end sheet (the paper "Daily
// Accounts Report"). Till figures come pre-filled and stay editable; bank in,
// catering and notes are typed in. Save as a draft, or Submit — after which
// only an admin or the owner can change it.

const niceDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const gbp = (n: number) => `£${n.toFixed(2)}`;
const toText = (n: number | null | undefined) => (n == null ? "" : String(Number(n)));

type Saved = (Partial<DailyValues> & { notes: string | null; status: "draft" | "submitted"; submitted_at: string | null }) | null;
type Day = { saved: Saved; till: DailyValues; locked: boolean; canUnlock: boolean };

export default function DailyAccountsView({ today, start }: { today: string; start: string }) {
  const { toast } = useToast();
  const [date, setDate] = useState(start);
  const [day, setDay] = useState<Day | null>(null);
  const [values, setValues] = useState<Record<DailyFieldKey, string>>({} as Record<DailyFieldKey, string>);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<null | "save" | "submit">(null);

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
            <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
              status === "submitted" ? "bg-emerald-100 text-emerald-800" : status === "draft" ? "bg-amber-100 text-amber-800" : "bg-[#F6F1E6] text-muted-foreground"
            }`}>
              {status === "submitted" ? "Submitted" : status === "draft" ? "Draft" : "Not entered yet"}
            </span>
          </div>

          {locked && (
            <p className="mb-3 rounded-lg bg-[#F6F1E6] px-3 py-2 text-[13px] text-muted-foreground">
              This day has been submitted. Ask an admin if something needs changing.
            </p>
          )}

          {!day ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
                {DAILY_FIELDS.map((f) => {
                  const till = day.till[f.key];
                  const differs = f.auto && till != null && values[f.key] !== "" && Number(values[f.key]) !== Number(till);
                  return (
                    <label key={f.key} className="block">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[13.5px] font-semibold">{f.label}</span>
                        <span className="text-[11.5px] text-muted-foreground">
                          {f.auto ? (till != null ? `Till: ${gbp(till)}` : "Till: —") : "Enter"}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className="text-[13px] text-muted-foreground">£</span>
                        <input className={input} inputMode="decimal" disabled={locked} placeholder="0.00" value={values[f.key] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^0-9.]/g, "") }))} />
                        {differs && !locked && (
                          <button type="button" title={`Use the till's figure (${gbp(till!)})`} onClick={() => setValues((v) => ({ ...v, [f.key]: toText(till) }))}
                            className="rounded-md border border-border px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-hover">↺</button>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{f.hint}</span>
                    </label>
                  );
                })}
              </div>

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
