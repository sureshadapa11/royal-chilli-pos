"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Job, JobKind } from "@/lib/catering-jobs";

// Daily accounts → Catering & events (133): each job once, with its total;
// payments (part payments too) recorded against it, so what's owed is worked
// out. Cash and bank transfer payments count as sales on the day received;
// card on our machine is already in the Z report.

const gbp = (n: number) => `£${n.toFixed(2)}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const METHODS = [{ key: "cash", label: "💷 Cash" }, { key: "bank", label: "🏦 Bank transfer" }, { key: "card", label: "💳 Card (our machine)" }];
const methodLabel = (m: string) => METHODS.find((x) => x.key === m)?.label ?? m;
const field = "w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px]";

export default function CateringJobsMonth({ month, today, canEnter, canCorrect, canDelete }: {
  month: string; today: string; canEnter: boolean; canCorrect: boolean; canDelete: boolean;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<{ owed: Job[]; month: Job[] } | null>(null);
  const [adding, setAdding] = useState<Job | "new" | null>(null);
  const [paying, setPaying] = useState<Job | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff/catering-jobs?month=${month}`);
    if (res.ok) setData(await res.json());
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  const owedTotal = data?.owed.reduce((s, j) => s + j.owed, 0) ?? 0;
  const monthPaid = data?.month.reduce((s, j) => s + j.paid, 0) ?? 0;

  async function act(url: string, init: RequestInit, done: string) {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ variant: "destructive", title: "Not saved", description: d.error }); return false; }
    toast({ variant: "success", title: done, description: d.warning });
    load();
    return true;
  }

  const ctx: Ctx = { canEnter, canCorrect, canDelete, act, setPaying, setAdding };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {canEnter && <button onClick={() => setAdding("new")} className="rounded-lg bg-[#E34435] px-4 py-2 text-[14px] font-semibold text-white">+ New catering / event</button>}
        {data && <span className="text-[13px] text-muted-foreground">Still owed <b className="text-amber-700">{gbp(owedTotal)}</b> · Paid on this month&apos;s jobs <b className="text-foreground">{gbp(monthPaid)}</b></span>}
      </div>

      {!data ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (
        <>
          <Section title={`Still owed (${data.owed.length})`} empty="Nothing owed. 🎉" jobs={data.owed} ctx={ctx} />
          <Section title="This month's jobs" empty="No catering or events this month." jobs={data.month} ctx={ctx} />
        </>
      )}

      {adding && <JobForm job={adding === "new" ? null : adding} today={today} onClose={() => setAdding(null)}
        onSave={async (body) => {
          const ok = adding === "new"
            ? await act("/api/staff/catering-jobs", { method: "POST", body: JSON.stringify(body) }, "Job added")
            : await act(`/api/staff/catering-jobs/${adding.id}`, { method: "PATCH", body: JSON.stringify(body) }, "Job saved");
          if (ok) setAdding(null);
        }} />}
      {paying && <PayForm job={paying} today={today} onClose={() => setPaying(null)}
        onSave={async (body) => { if (await act(`/api/staff/catering-jobs/${paying.id}/payments`, { method: "POST", body: JSON.stringify(body) }, "Payment recorded")) setPaying(null); }} />}
    </div>
  );
}

type Ctx = {
  canEnter: boolean; canCorrect: boolean; canDelete: boolean;
  act: (url: string, init: RequestInit, done: string) => Promise<boolean>;
  setPaying: (j: Job) => void; setAdding: (j: Job) => void;
};

function Section({ title, empty, jobs, ctx }: { title: string; empty: string; jobs: Job[]; ctx: Ctx }) {
  return (
    <section>
      <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</h3>
      {jobs.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-4 text-[13px] text-muted-foreground">{empty}</p> : (
        <div className="space-y-2">{jobs.map((j) => <JobCard key={j.id} j={j} ctx={ctx} />)}</div>
      )}
    </section>
  );
}

function JobCard({ j, ctx }: { j: Job; ctx: Ctx }) {
const { canEnter, canCorrect, canDelete, act, setPaying, setAdding } = ctx;
  const [open, setOpen] = useState(false);
  const pct = j.total ? Math.min(100, (j.paid / j.total) * 100) : 0;
  return (
    <div className={`rounded-xl border border-border bg-white px-4 py-3 ${j.cancelled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${j.kind === "event" ? "bg-violet-100 text-violet-800" : "bg-amber-100 text-amber-800"}`}>{j.kind === "event" ? "🎉 Event" : "🍱 Catering"}</span>
        <button onClick={() => setOpen(!open)} className="text-left text-[15px] font-semibold hover:underline">{j.customer}</button>
        <span className="text-[13px] text-muted-foreground">{day(j.date)}{j.phone ? ` · ${j.phone}` : ""}</span>
        {j.cancelled && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11.5px] font-semibold">Cancelled</span>}
        <span className="ml-auto text-[13px] tabular-nums">
          {gbp(j.paid)} of {gbp(j.total)} · {j.owed > 0 ? <b className="text-amber-700">{gbp(j.owed)} owed</b> : <b className="text-emerald-700">{j.cancelled ? "—" : "Paid in full"}</b>}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F6F1E6]"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${pct}%` }} /></div>
      <div className="mt-2 flex flex-wrap gap-2">
        {canEnter && j.owed > 0 && <button onClick={() => setPaying(j)} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-[12.5px] font-semibold text-emerald-800">+ Record payment</button>}
        <button onClick={() => setOpen(!open)} className="rounded-lg border border-border px-3 py-1 text-[12.5px] font-semibold">{open ? "Hide" : `Payments (${j.payments.length})`}</button>
        {canCorrect && <button onClick={() => setAdding(j)} className="rounded-lg border border-border px-3 py-1 text-[12.5px] font-semibold">✏️ Edit</button>}
        {canCorrect && <button onClick={() => window.confirm(j.cancelled ? `Bring back ${j.customer}?` : `Cancel ${j.customer}? It won't count as owed any more; payments stay.`)
          && act(`/api/staff/catering-jobs/${j.id}`, { method: "PATCH", body: JSON.stringify({ cancelled: !j.cancelled }) }, j.cancelled ? "Job brought back" : "Job cancelled")}
          className="rounded-lg border border-border px-3 py-1 text-[12.5px] font-semibold">{j.cancelled ? "↩︎ Bring back" : "Cancel job"}</button>}
        {canDelete && j.payments.length === 0 && <button onClick={() => window.confirm(`Delete ${j.customer}?`) && act(`/api/staff/catering-jobs/${j.id}`, { method: "DELETE" }, "Job deleted")}
          className="rounded-lg border border-red-200 px-3 py-1 text-[12.5px] font-semibold text-red-700">🗑️ Delete</button>}
      </div>
      {open && (
        <div className="mt-2 space-y-1 border-t border-dashed border-border pt-2 text-[13px]">
          {j.notes && <p className="text-muted-foreground">📝 {j.notes}</p>}
          {j.payments.length === 0 ? <p className="text-muted-foreground">No payments yet.</p> : j.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3">
              <span className="tabular-nums">{day(p.date)}</span>
              <b className="tabular-nums">{gbp(p.amount)}</b>
              <span className="text-muted-foreground">{methodLabel(p.method)}{p.method === "card" ? " · already in Z report" : ""}</span>
              {p.by && <span className="text-muted-foreground">· {p.by}</span>}
              {canDelete && <button onClick={() => window.confirm(`Delete the ${gbp(p.amount)} payment?`) && act(`/api/staff/catering-jobs/${j.id}/payments?payment=${p.id}`, { method: "DELETE" }, "Payment deleted")}
                className="ml-auto text-[12px] text-red-700 hover:underline">Delete</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[18px] font-bold">{title}</h2>
        <div className="mt-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function MethodPick({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {METHODS.map((m) => (
        <button key={m.key} type="button" onClick={() => onChange(m.key)}
          className={`rounded-lg border px-2 py-2 text-[12.5px] font-semibold ${value === m.key ? "border-[#E34435] bg-[#FDECEA] text-[#B4231A]" : "border-border"}`}>{m.label}</button>
      ))}
    </div>
  );
}

function JobForm({ job, today, onClose, onSave }: { job: Job | null; today: string; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [kind, setKind] = useState<JobKind>(job?.kind ?? "event");
  const [customer, setCustomer] = useState(job?.customer ?? "");
  const [phone, setPhone] = useState(job?.phone ?? "");
  const [date, setDate] = useState(job?.date ?? today);
  const [total, setTotal] = useState(job ? String(job.total) : "");
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [deposit, setDeposit] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); await onSave({ kind, customer, phone, date, total, notes, ...(job ? {} : { deposit, deposit_method: method, deposit_date: today }) }); setBusy(false); };
  const label = "mb-1 block text-[13px] font-semibold";
  return (
    <Modal title={job ? "Edit job" : "New catering / event"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-1.5">
        {(["catering", "event"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-lg border px-3 py-2.5 text-[14px] font-semibold ${kind === k ? "border-[#E34435] bg-[#FDECEA] text-[#B4231A]" : "border-border"}`}>{k === "event" ? "🎉 Event" : "🍱 Catering"}</button>
        ))}
      </div>
      <label className="block"><span className={label}>Customer / event name</span><input className={field} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Sharma wedding" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>Date</span><input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block"><span className={label}>Total price (£)</span><input className={`${field} text-right`} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label>
      </div>
      <label className="block"><span className={label}>Phone (optional)</span><input className={field} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <label className="block"><span className={label}>Notes (optional)</span><textarea rows={2} className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Guests, menu, venue…" /></label>
      {!job && (
        <div className="rounded-xl bg-[#FBF8F1] p-3">
          <label className="block"><span className={label}>Deposit paid today (optional, £)</span><input className={`${field} text-right`} inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label>
          {Number(deposit) > 0 && <div className="mt-2"><MethodPick value={method} onChange={setMethod} /></div>}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 font-semibold">Cancel</button>
        <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-[#E34435] py-2.5 font-bold text-white disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function PayForm({ job, today, onClose, onSave }: { job: Job; today: string; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [amount, setAmount] = useState(String(job.owed));
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const label = "mb-1 block text-[13px] font-semibold";
  return (
    <Modal title={`Payment · ${job.customer}`} onClose={onClose}>
      <p className="text-[13px] text-muted-foreground">Total {gbp(job.total)} · paid {gbp(job.paid)} · <b className="text-amber-700">{gbp(job.owed)} owed</b></p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>Amount (£)</span><input className={`${field} text-right`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
        <label className="block"><span className={label}>Date paid</span><input type="date" className={field} max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div><span className={label}>Paid how?</span><MethodPick value={method} onChange={setMethod} /></div>
      {method === "card" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">Card on our machine is already in the Z report, so it counts toward this job but isn&apos;t added to sales again.</p>}
      {method === "cash" && <p className="text-[12.5px] text-muted-foreground">🔒 Cash goes into the Safe.</p>}
      <label className="block"><span className={label}>Note (optional)</span><input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. second instalment" /></label>
      <div className="flex gap-2 pt-1">
        <button onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 font-semibold">Cancel</button>
        <button onClick={async () => { setBusy(true); await onSave({ amount, method, date, note }); setBusy(false); }} disabled={busy}
          className="flex-1 rounded-xl bg-emerald-700 py-2.5 font-bold text-white disabled:opacity-60">{busy ? "Saving…" : "Record payment"}</button>
      </div>
    </Modal>
  );
}
