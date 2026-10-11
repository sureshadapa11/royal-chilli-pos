"use client";

import { useState } from "react";
import ReceiptPhotos, { type Receipt } from "@/components/staff/ReceiptPhotos";

// The staff links' forms (lib/staff-links.ts): Day End and Cash In / Out.
// Input only — after saving they say "Saved", never show figures.

const PLATFORMS = [
  { key: "just_eat", label: "Just Eat" },
  { key: "deliveroo", label: "Deliveroo" },
  { key: "uber_eats", label: "Uber Eats" },
  { key: "hiest", label: "Hiest" },
] as const;

const input = "w-28 rounded-lg border border-border bg-background px-2.5 py-2 text-right text-[15px] tabular-nums";
const card = "rounded-2xl border border-border bg-white p-4 shadow-sm";
const head = "mb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

function Shell({ business, title, children }: { business: string; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fdf8ec] text-[#2b1a14]">
      <header className="bg-[#e4473a] px-5 pb-4 pt-5 text-white">
        <div className="font-[family-name:var(--font-playfair)] text-xl">{business}</div>
        <div className="text-sm opacity-85">{title}</div>
      </header>
      <main className="mx-auto max-w-md space-y-3 px-4 py-4 pb-10">{children}</main>
    </div>
  );
}

/** PIN pad box: shows "✓ Name" once the PIN is right. */
function PinBox({ token, onOk }: { token: string; onOk: (pin: string, name: string) => void }) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  async function check(p: string) {
    setPin(p);
    setName("");
    setErr("");
    if (p.length !== 4) return;
    const res = await fetch(`/api/links/${token}/pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: p }) }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    if (res?.ok && d?.name) { setName(d.name); onOk(p, d.name); } else setErr(d?.error ?? "Couldn't check the PIN.");
  }
  return (
    <section className={card}>
      <div className={head}>Your PIN</div>
      <input value={pin} onChange={(e) => check(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" autoComplete="off"
        placeholder="••••" className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-2xl tracking-[0.6em]" />
      {name && <p className="mt-2 text-center text-sm font-semibold text-emerald-700">✓ {name}</p>}
      {err && <p className="mt-2 text-center text-sm text-red-600">{err}</p>}
    </section>
  );
}

function Saved({ business, title, what, again }: { business: string; title: string; what: string; again?: () => void }) {
  return (
    <Shell business={business} title={title}>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center text-emerald-800">
        <div className="text-4xl">✓</div>
        <p className="mt-1 text-lg font-semibold">Saved</p>
        <p className="mt-1 text-sm">{what}</p>
      </div>
      {again && <button onClick={again} className="w-full rounded-xl border border-border bg-white py-3 font-semibold">Add another</button>}
    </Shell>
  );
}

const ukToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

export function DayEndForm({ token, business, today }: { token: string; business: string; today: string }) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [v, setV] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value.replace(/[^0-9.]/g, "") });
  const box = (k: string, w = "") => <input value={v[k] ?? ""} onChange={set(k)} inputMode="decimal" placeholder="0.00" className={`${input} ${w}`} />;

  async function submit() {
    setErr("");
    if (!pin) return setErr("Enter your PIN first.");
    if (!v.z_report) return setErr("Enter the Z report total (0 if closed).");
    setBusy(true);
    const res = await fetch(`/api/links/${token}/day-end`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, date, values: v, notes, photo_ids: photos.map((p) => p.id) }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) return setErr(d?.error ?? "Couldn't save. Check your connection and try again.");
    setDone(true);
  }

  if (done) return <Saved business={business} title="Day End" what={`Day End for ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, entered by ${name}.`} />;
  return (
    <Shell business={business} title="Day End">
      <PinBox token={token} onOk={(p, n) => { setPin(p); setName(n); }} />
      <section className={card}>
        <div className={head}>Trading day</div>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2" />
        <p className="mt-1 text-xs text-muted-foreground">Each day can be entered once. Forgot a day? Pick it here.</p>
      </section>
      <section className={card}>
        <div className={head}>Till</div>
        {[["z_report", "Z report total *"], ["card", "Card"], ["cash", "Cash"], ["tips", "Tips"]].map(([k, l]) => (
          <label key={k} className="flex items-center justify-between py-1.5 text-[15px]">{l} {box(k)}</label>
        ))}
      </section>
      <section className={card}>
        <div className={head}>Delivery platforms</div>
        <div className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground"><span /><span className="text-right">Sales</span><span className="text-right">Commission</span></div>
        {PLATFORMS.map((p) => (
          <div key={p.key} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 py-1 text-[15px]">
            <span>{p.label}</span>{box(p.key, "!w-full")}{box(`${p.key}_commission`, "!w-full")}
          </div>
        ))}
      </section>
      <section className={card}>
        <div className={head}>Catering</div>
        <label className="flex items-center justify-between py-1.5 text-[15px]">Paid today {box("catering_paid")}</label>
        <label className="flex items-center justify-between py-1.5 text-[15px]">Still to be paid {box("catering_pending")}</label>
      </section>
      <section className={card}>
        <div className={head}>Cash drawer</div>
        <label className="flex items-center justify-between py-1.5 text-[15px]">Cash counted at close {box("closing_balance")}</label>
      </section>
      <section className={card}>
        <ReceiptPhotos entity="daily_account" label="Z report photo (optional)" required={false} value={photos} onChange={setPhotos}
          uploadUrl={`/api/links/${token}/photo`} extraFields={{ pin }} />
        {!pin && <p className="mt-1 text-xs text-muted-foreground">Enter your PIN before adding a photo.</p>}
      </section>
      <section className={card}>
        <div className={head}>Notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything unusual today" className="h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2" />
      </section>
      {err && <p className="text-center text-sm font-medium text-red-600">{err}</p>}
      <button onClick={submit} disabled={busy} className="w-full rounded-xl bg-[#e4473a] py-3.5 text-base font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Submit Day End"}</button>
    </Shell>
  );
}

export function CashForm({ token, business, today }: { token: string; business: string; today: string }) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [date, setDate] = useState(today);
  const [photos, setPhotos] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  async function save() {
    setErr("");
    if (!pin) return setErr("Enter your PIN first.");
    if (!(Number(amount) > 0)) return setErr("Enter the amount.");
    if (reason.trim().length < 3) return setErr("Write the reason.");
    if (direction === "out" && photos.length === 0) return setErr("Add a photo of the receipt.");
    setBusy(true);
    const res = await fetch(`/api/links/${token}/cash`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, direction, amount, reason, paid_to: paidTo, date, photo_ids: photos.map((p) => p.id) }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) return setErr(d?.error ?? "Couldn't save. Check your connection and try again.");
    setDone(`${direction === "out" ? "Money out" : "Money in"} £${Number(amount).toFixed(2)}, entered by ${name}.`);
  }

  if (done) return <Saved business={business} title="Cash In / Out" what={done} again={() => { setDone(""); setAmount(""); setReason(""); setPaidTo(""); setPhotos([]); setDate(ukToday()); }} />;
  return (
    <Shell business={business} title="Cash In / Out">
      <PinBox token={token} onOk={(p, n) => { setPin(p); setName(n); }} />
      <div className="grid grid-cols-2 gap-2">
        {(["out", "in"] as const).map((d) => (
          <button key={d} onClick={() => setDirection(d)}
            className={`rounded-xl border-2 py-3 font-bold ${direction === d ? (d === "out" ? "border-[#e4473a] bg-red-50 text-[#e4473a]" : "border-emerald-600 bg-emerald-50 text-emerald-700") : "border-border bg-white text-muted-foreground"}`}>
            {d === "out" ? "− Money OUT" : "+ Money IN"}
          </button>
        ))}
      </div>
      <section className={card}>
        <div className={head}>Amount</div>
        <div className="flex items-center rounded-xl border border-border bg-background px-4">
          <span className="text-2xl font-bold text-muted-foreground">£</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.00" className="w-full bg-transparent py-3 text-center text-3xl font-bold outline-none" />
        </div>
      </section>
      <section className={card}>
        <div className={head}>Reason</div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === "out" ? "e.g. Vegetables from cash & carry" : "e.g. Catering deposit"} className="h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2" />
        <label className="mt-2 flex items-center justify-between gap-2 text-[15px]">{direction === "out" ? "Paid to" : "From"} (optional)
          <input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} className="w-40 rounded-lg border border-border bg-background px-2.5 py-2" />
        </label>
        <label className="mt-1 flex items-center justify-between gap-2 text-[15px]">Date
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="w-40 rounded-lg border border-border bg-background px-2.5 py-2" />
        </label>
      </section>
      <section className={card}>
        <ReceiptPhotos entity="cash_movement" label={direction === "out" ? "Receipt photo" : "Photo (optional)"} required={direction === "out"} value={photos} onChange={setPhotos}
          uploadUrl={`/api/links/${token}/photo`} extraFields={{ pin }} />
        {!pin && <p className="mt-1 text-xs text-muted-foreground">Enter your PIN before adding a photo.</p>}
      </section>
      {err && <p className="text-center text-sm font-medium text-red-600">{err}</p>}
      <button onClick={save} disabled={busy} className="w-full rounded-xl bg-[#e4473a] py-3.5 text-base font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
    </Shell>
  );
}
