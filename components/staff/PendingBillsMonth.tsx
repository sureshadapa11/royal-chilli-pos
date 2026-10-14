"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Bill } from "@/lib/pending-bills";

// Daily accounts → Pending bills (134): each unpaid bill once; payments (part
// payments too) recorded against it, so what's owed is worked out. Tracking
// only — the sale is in that day's Z report and the payment is taken at the
// till, so nothing here changes sales or the cash check.

const gbp = (n: number) => `£${n.toFixed(2)}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const METHODS = [{ key: "cash", label: "💷 Cash" }, { key: "card", label: "💳 Card" }, { key: "bank", label: "🏦 Bank transfer" }];
const methodLabel = (m: string) => METHODS.find((x) => x.key === m)?.label ?? m;
const field = "w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px]";
const daysOld = (d: string, today: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000);

type Ctx = {
  today: string; canEnter: boolean; canCorrect: boolean; canDelete: boolean;
  act: (url: string, init: RequestInit, done: string) => Promise<boolean>;
  setPaying: (b: Bill) => void; setEditing: (b: Bill) => void;
};

export default function PendingBillsMonth({ month, today, canEnter, canCorrect, canDelete }: {
  month: string; today: string; canEnter: boolean; canCorrect: boolean; canDelete: boolean;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<{ owed: Bill[]; month: Bill[] } | null>(null);
  const [editing, setEditing] = useState<Bill | "new" | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff/pending-bills?month=${month}`);
    if (res.ok) setData(await res.json());
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function act(url: string, init: RequestInit, done: string) {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ variant: "destructive", title: "Not saved", description: d.error }); return false; }
    toast({ variant: "success", title: done });
    load();
    return true;
  }
  const ctx: Ctx = { today, canEnter, canCorrect, canDelete, act, setPaying, setEditing };
  const owedTotal = data?.owed.reduce((s, b) => s + b.owed, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {canEnter && <button onClick={() => setEditing("new")} className="rounded-lg bg-[#E34435] px-4 py-2 text-[14px] font-semibold text-white">+ New unpaid bill</button>}
        {data && <span className="text-[13px] text-muted-foreground">Still owed <b className="text-amber-700">{gbp(owedTotal)}</b> by {data.owed.length} {data.owed.length === 1 ? "bill" : "bills"}</span>}
      </div>
      {!data ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (
        <>
          <Section title={`Still owed (${data.owed.length})`} empty="Nothing owed. 🎉" bills={data.owed} ctx={ctx} />
          <Section title="This month's bills" empty="No unpaid bills this month." bills={data.month} ctx={ctx} />
        </>
      )}
      {editing && <BillForm bill={editing === "new" ? null : editing} today={today} onClose={() => setEditing(null)}
        onSave={async (body) => {
          const ok = editing === "new"
            ? await act("/api/staff/pending-bills", { method: "POST", body: JSON.stringify(body) }, "Bill added")
            : await act(`/api/staff/pending-bills/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) }, "Bill saved");
          if (ok) setEditing(null);
        }} />}
      {paying && <PayForm bill={paying} today={today} onClose={() => setPaying(null)}
        onSave={async (body) => { if (await act(`/api/staff/pending-bills/${paying.id}/payments`, { method: "POST", body: JSON.stringify(body) }, "Payment recorded")) setPaying(null); }} />}
    </div>
  );
}

function Section({ title, empty, bills, ctx }: { title: string; empty: string; bills: Bill[]; ctx: Ctx }) {
  return (
    <section>
      <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</h3>
      {bills.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-4 text-[13px] text-muted-foreground">{empty}</p>
        : <div className="space-y-2">{bills.map((b) => <BillCard key={b.id} b={b} ctx={ctx} />)}</div>}
    </section>
  );
}

function BillCard({ b, ctx }: { b: Bill; ctx: Ctx }) {
  const { today, canEnter, canCorrect, canDelete, act, setPaying, setEditing } = ctx;
  const [open, setOpen] = useState(false);
  const age = daysOld(b.date, today);
  return (
    <div className={`rounded-xl border border-border bg-white px-4 py-3 ${b.cancelled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button onClick={() => setOpen(!open)} className="text-left text-[15px] font-semibold hover:underline">🧾 {b.customer}</button>
        <span className="text-[13px] text-muted-foreground">{day(b.date)}{b.phone ? ` · ${b.phone}` : ""}</span>
        {b.owed > 0 && age >= 7 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11.5px] font-semibold text-red-700">{age} days</span>}
        {b.cancelled && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11.5px] font-semibold">Cancelled</span>}
        <span className="ml-auto text-[13px] tabular-nums">
          {gbp(b.paid)} of {gbp(b.amount)} · {b.owed > 0 ? <b className="text-amber-700">{gbp(b.owed)} owed</b> : <b className="text-emerald-700">{b.cancelled ? "—" : "Paid"}</b>}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {canEnter && b.owed > 0 && <button onClick={() => setPaying(b)} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-[12.5px] font-semibold text-emerald-800">+ Record payment</button>}
        <button onClick={() => setOpen(!open)} className="rounded-lg border border-border px-3 py-1 text-[12.5px] font-semibold">{open ? "Hide" : `Payments (${b.payments.length})`}</button>
        {canCorrect && <button onClick={() => setEditing(b)} className="rounded-lg border border-border px-3 py-1 text-[12.5px] font-semibold">✏️ Edit</button>}
        {canCorrect && <button onClick={() => window.confirm(b.cancelled ? `Bring back ${b.customer}'s bill?` : `Cancel ${b.customer}'s bill? It won't count as owed any more.`)
          && act(`/api/staff/pending-bills/${b.id}`, { method: "PATCH", body: JSON.stringify({ cancelled: !b.cancelled }) }, b.cancelled ? "Bill brought back" : "Bill cancelled")}
          className="rounded-lg border border-border px-3 py-1 text-[12.5px] font-semibold">{b.cancelled ? "↩︎ Bring back" : "Cancel bill"}</button>}
        {canDelete && <button onClick={() => window.confirm(`Delete ${b.customer}'s bill${b.payments.length ? " and its payments" : ""}?`) && act(`/api/staff/pending-bills/${b.id}`, { method: "DELETE" }, "Bill deleted")}
          className="rounded-lg border border-red-200 px-3 py-1 text-[12.5px] font-semibold text-red-700">🗑️ Delete</button>}
      </div>
      {open && (
        <div className="mt-2 space-y-1 border-t border-dashed border-border pt-2 text-[13px]">
          {b.notes && <p className="text-muted-foreground">📝 {b.notes}</p>}
          {b.payments.length === 0 ? <p className="text-muted-foreground">No payments yet.</p> : b.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3">
              <span className="tabular-nums">{day(p.date)}</span><b className="tabular-nums">{gbp(p.amount)}</b>
              <span className="text-muted-foreground">{methodLabel(p.method)}{p.by ? ` · ${p.by}` : ""}</span>
              {canDelete && <button onClick={() => window.confirm(`Delete the ${gbp(p.amount)} payment?`) && act(`/api/staff/pending-bills/${b.id}/payments?payment=${p.id}`, { method: "DELETE" }, "Payment deleted")}
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

const label = "mb-1 block text-[13px] font-semibold";
function Buttons({ onClose, busy, text, onSave }: { onClose: () => void; busy: boolean; text: string; onSave: () => void }) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 font-semibold">Cancel</button>
      <button onClick={onSave} disabled={busy} className="flex-1 rounded-xl bg-[#E34435] py-2.5 font-bold text-white disabled:opacity-60">{busy ? "Saving…" : text}</button>
    </div>
  );
}

function BillForm({ bill, today, onClose, onSave }: { bill: Bill | null; today: string; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [customer, setCustomer] = useState(bill?.customer ?? "");
  const [phone, setPhone] = useState(bill?.phone ?? "");
  const [date, setDate] = useState(bill?.date ?? today);
  const [amount, setAmount] = useState(bill ? String(bill.amount) : "");
  const [notes, setNotes] = useState(bill?.notes ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={bill ? "Edit bill" : "New unpaid bill"} onClose={onClose}>
      <label className="block"><span className={label}>Customer</span><input className={field} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name or table / account" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>Date of bill</span><input type="date" className={field} max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block"><span className={label}>Amount owed (£)</span><input className={`${field} text-right`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" /></label>
      </div>
      <label className="block"><span className={label}>Phone (optional)</span><input className={field} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <label className="block"><span className={label}>Note (optional)</span><input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. will pay Friday" /></label>
      <Buttons onClose={onClose} busy={busy} text="Save" onSave={async () => { setBusy(true); await onSave({ customer, phone, date, amount, notes }); setBusy(false); }} />
    </Modal>
  );
}

function PayForm({ bill, today, onClose, onSave }: { bill: Bill; today: string; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [amount, setAmount] = useState(String(bill.owed));
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Payment · ${bill.customer}`} onClose={onClose}>
      <p className="text-[13px] text-muted-foreground">Bill {gbp(bill.amount)} · paid {gbp(bill.paid)} · <b className="text-amber-700">{gbp(bill.owed)} owed</b></p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>Amount (£)</span><input className={`${field} text-right`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
        <label className="block"><span className={label}>Date paid</span><input type="date" className={field} min={bill.date} max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div>
        <span className={label}>Paid how? (at the till)</span>
        <div className="grid grid-cols-3 gap-1.5">
          {METHODS.map((m) => (
            <button key={m.key} type="button" onClick={() => setMethod(m.key)}
              className={`rounded-lg border px-2 py-2 text-[12.5px] font-semibold ${method === m.key ? "border-[#E34435] bg-[#FDECEA] text-[#B4231A]" : "border-border"}`}>{m.label}</button>
          ))}
        </div>
      </div>
      <Buttons onClose={onClose} busy={busy} text="Record payment" onSave={async () => { setBusy(true); await onSave({ amount, method, date }); setBusy(false); }} />
    </Modal>
  );
}
