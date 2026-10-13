"use client";

import { useEffect, useRef, useState } from "react";
import ReceiptPhotos, { type Receipt } from "@/components/staff/ReceiptPhotos";
import { CASH_CATEGORIES, CATEGORY_HINT, PAY_METHODS, cashCategory } from "@/lib/cash-categories";

// The staff links' forms (lib/staff-links.ts): Day End and Cash In / Out,
// built for a phone held in one hand (agreed mock-up 2026-10-11): a big PIN
// pad, number keys on every amount, boxes 16px+ so iPhones don't zoom, the
// Save button always at the bottom, what's typed kept on the phone until
// it's sent (never the PIN), a "Check your figures" step before Day End is
// sent, and a clear "Not saved" with the entries kept when there's no signal.
// Input only — after saving they say "Saved", never show the business's figures.

const PLATFORMS = [
  { key: "just_eat", label: "Just Eat" },
  { key: "deliveroo", label: "Deliveroo" },
  { key: "uber_eats", label: "Uber Eats" },
  { key: "hiest", label: "Hiest" },
] as const;

const card = "rounded-2xl border border-[#eadfcc] bg-white p-3.5 shadow-sm";
const head = "mb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7a6a60]";
const bigBtn = "h-14 w-full rounded-2xl text-[17px] font-semibold disabled:opacity-60";

type Picks = { staff: { id: number; name: string }[]; suppliers: { id: number; name: string }[]; jobs: { id: number; name: string }[] };

/** What's typed, kept on this phone until it's sent (localStorage can be blocked: then just not kept). */
function useDraft<T extends object>(key: string, initial: T): [T, (next: T | ((p: T) => T)) => void, () => void, string | null] {
  const [value, setValue] = useState<T>(initial);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const loaded = useRef(false);
  const skipNext = useRef(false); // the save right after loading would write the blank form over the draft
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw) as { v: T; at: string };
        setValue({ ...initial, ...d.v });
        setSavedAt(d.at);
      }
    } catch { /* not available */ }
    loaded.current = true;
    skipNext.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    if (skipNext.current) { skipNext.current = false; return; }
    try {
      const at = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      window.localStorage.setItem(key, JSON.stringify({ v: value, at }));
      setSavedAt(at);
    } catch { /* not available */ }
  }, [key, value]);
  const clear = () => { try { window.localStorage.removeItem(key); } catch { /* */ } setSavedAt(null); };
  return [value, setValue, clear, savedAt];
}

function Shell({ business, title, children, bar }: { business: string; title: string; children: React.ReactNode; bar?: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#fdf8ec] text-[#2b1a14]">
      <header className="sticky top-0 z-10 bg-[#e4473a] px-5 pb-3.5 pt-4 text-white shadow-sm">
        <div className="font-[family-name:var(--font-playfair)] text-[19px] leading-tight">{business}</div>
        <div className="text-[13px] opacity-90">{title}</div>
      </header>
      <main className={`mx-auto max-w-md space-y-3 px-3 pt-3 ${bar ? "pb-40" : "pb-10"}`}>{children}</main>
      {bar && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#fdf8ec] from-70% to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-5">
          <div className="mx-auto max-w-md space-y-2">{bar}</div>
        </div>
      )}
    </div>
  );
}

/** A £ box that opens the number keys; 17px so the page never zooms. */
function Money({ value, onChange, wide }: { value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <span className={`flex h-12 items-center rounded-xl border-[1.5px] border-[#eadfcc] bg-[#fffdf8] px-3 focus-within:border-[#e4473a] ${wide ? "w-full" : "w-36"}`}>
      <span className="mr-1 text-[16px] text-[#7a6a60]">£</span>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" enterKeyHint="next"
        placeholder="0.00" className="w-full bg-transparent text-right text-[17px] outline-none" />
    </span>
  );
}

/**
 * A date box that always fits its card: iPhone Safari's own date input
 * ignores the width it's given and spills over the edge, so the date is
 * shown as text ("Sat 11 Oct") with the real picker laid invisibly on top —
 * tapping anywhere on it opens the phone's date picker.
 */
function DateBox({ value, max, onChange }: { value: string; max: string; onChange: (d: string) => void }) {
  return (
    <span className="relative flex h-12 w-full min-w-0 items-center justify-between overflow-hidden rounded-xl border-[1.5px] border-[#eadfcc] bg-[#fffdf8] px-3 text-[16px]">
      <span className="truncate">{niceDay(value)}</span>
      <span className="ml-2 shrink-0 text-[14px] font-semibold text-[#e4473a]">📅 Change</span>
      <input type="date" value={value} max={max} aria-label="Date" onChange={(e) => e.target.value && onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [appearance:none]" />
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-h-[56px] items-center justify-between gap-3 text-[16px]">{label}{children}</label>;
}

/** Big on-screen PIN pad; checks the PIN when the 4th digit is pressed. */
function PinPad({ token, onOk }: { token: string; onOk: (pin: string, name: string, picks: Picks) => void }) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function press(k: string) {
    if (busy || name) return;
    setErr("");
    const next = k === "clear" ? "" : k === "back" ? pin.slice(0, -1) : (pin + k).slice(0, 4);
    setPin(next);
    if (next.length !== 4) return;
    setBusy(true);
    const res = await fetch(`/api/links/${token}/pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: next }) }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    setBusy(false);
    if (res?.ok && d?.name) { setName(d.name); onOk(next, d.name, { staff: d.staff ?? [], suppliers: d.suppliers ?? [], jobs: d.jobs ?? [] }); }
    else { setErr(res ? d?.error ?? "Couldn't check the PIN." : "No connection. Try again."); setPin(""); }
  }
  if (name) {
    return (
      <section className={`${card} flex items-center justify-between`}>
        <span className="text-[18px] font-bold text-emerald-700">✓ {name}</span>
        <button onClick={() => { setName(""); setPin(""); }} className="h-10 rounded-xl border border-[#eadfcc] px-3 text-[14px] text-[#7a6a60]">Not me</button>
      </section>
    );
  }
  return (
    <section className={card}>
      <div className={head}>Your PIN</div>
      <div className="mb-3 flex justify-center gap-3" aria-label={`${pin.length} of 4 digits`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-[#2b1a14]" : "border-2 border-[#eadfcc]"}`} />)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((k) => (
          <button key={k} type="button" onClick={() => press(k)} disabled={busy}
            className="h-14 rounded-2xl bg-[#f6f1e6] text-[22px] font-semibold active:bg-[#eadfcc] disabled:opacity-60">
            {k === "clear" ? <span className="text-[15px]">Clear</span> : k === "back" ? "⌫" : k}
          </button>
        ))}
      </div>
      {busy && <p className="mt-2 text-center text-[14px] text-[#7a6a60]">Checking…</p>}
      {err && <p className="mt-2 text-center text-[14px] font-medium text-red-600">{err}</p>}
    </section>
  );
}

function Saved({ business, title, what, again }: { business: string; title: string; what: string; again?: () => void }) {
  return (
    <Shell business={business} title={title} bar={again ? <button onClick={again} className={`${bigBtn} bg-[#e4473a] text-white`}>Add another</button> : undefined}>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center text-emerald-800">
        <div className="text-5xl">✓</div>
        <p className="mt-1 text-[19px] font-semibold">Saved</p>
        <p className="mt-1 text-[15px]">{what}</p>
      </div>
    </Shell>
  );
}

function NotSaved({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-center text-[15px] text-orange-900" role="alert">
      <b>⚠️ Not saved.</b> {message}
    </div>
  );
}

const ukToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const niceDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const gbp = (v: string | undefined) => (v === undefined || v === "" ? "—" : `£${Number(v).toFixed(2)}`);

// ── Day End ──────────────────────────────────────────────────────────────

export function DayEndForm({ token, business, today }: { token: string; business: string; today: string }) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft, clearDraft, savedAt] = useDraft(`dayend:${token}`, { date: today, v: {} as Record<string, string>, notes: "" });
  const [photos, setPhotos] = useState<Receipt[]>([]);
  const [step, setStep] = useState<"form" | "check">("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const v = draft.v;
  const set = (k: string) => (val: string) => setDraft((d) => ({ ...d, v: { ...d.v, [k]: val } }));

  function toCheck() {
    setErr("");
    if (!pin) return setErr("Enter your PIN first.");
    if (!v.z_report) return setErr("Enter the Z report total (0 if closed).");
    setStep("check");
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/links/${token}/day-end`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, date: draft.date, values: v, notes: draft.notes, photo_ids: photos.map((p) => p.id) }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => ({}));
    if (!res) return setErr("No connection. Your figures are still here. Tap Submit again.");
    if (!res.ok) return setErr(d?.error ?? "Couldn't save. Please try again.");
    clearDraft();
    setDone(true);
  }

  if (done) return <Saved business={business} title="Day End" what={`Day End for ${niceDay(draft.date)}, entered by ${name}.`} />;

  if (step === "check") {
    const line = (label: string, value: string) => (
      <div className="flex justify-between gap-3 border-b border-[#f3ecdf] py-2 text-[15px] last:border-0"><span>{label}</span><b className="text-right font-semibold">{value}</b></div>
    );
    return (
      <Shell business={business} title="Check your figures" bar={<>
        {err && <NotSaved message={err} />}
        <button onClick={submit} disabled={busy} className={`${bigBtn} bg-[#e4473a] text-white`}>{busy ? "Sending…" : "✓ Submit Day End"}</button>
        <button onClick={() => setStep("form")} disabled={busy} className={`${bigBtn} border-[1.5px] border-[#eadfcc] bg-white`}>← Change something</button>
      </>}>
        <section className={card}>
          <div className={head}>{niceDay(draft.date)} · {name}</div>
          {line("Z report", gbp(v.z_report))}
          {line("Card", gbp(v.card))}
          {line("Cash", gbp(v.cash))}
          {line("Tips", gbp(v.tips))}
          {PLATFORMS.map((p) => (v[p.key] || v[`${p.key}_commission`]) ? <div key={p.key}>{line(p.label, `${gbp(v[p.key])} · comm ${gbp(v[`${p.key}_commission`])}`)}</div> : null)}
          {(v.catering_paid || v.catering_pending) && line("Catering paid / pending", `${gbp(v.catering_paid)} / ${gbp(v.catering_pending)}`)}
          {line("Opening cash", gbp(v.opening_balance))}
          {line("Bank in", gbp(v.bank_in))}
          {line("Cash counted", gbp(v.closing_balance))}
          {line("Pending bills", gbp(v.pending))}
          {photos.length > 0 && line("Z report photo", "✓ added")}
          {draft.notes && line("Notes", draft.notes)}
        </section>
        <p className="px-2 text-center text-[13px] text-[#7a6a60]">Only what you typed. Once sent, this day is locked.</p>
      </Shell>
    );
  }

  return (
    <Shell business={business} title={name ? `Day End · ✓ ${name}` : "Day End"} bar={<>
      {err && <NotSaved message={err} />}
      <button onClick={toCheck} className={`${bigBtn} bg-[#e4473a] text-white`}>Check my figures →</button>
    </>}>
      {savedAt && <span className="inline-block rounded-full bg-[#fdf0c9] px-2.5 py-1 text-[11.5px] font-semibold text-[#8a6400]">Kept on this phone · {savedAt}</span>}
      <PinPad token={token} onOk={(p, n) => { setPin(p); setName(n); }} />
      <section className={card}>
        <div className={head}>Trading day</div>
        <DateBox value={draft.date} max={today} onChange={(d) => setDraft((x) => ({ ...x, date: d }))} />
        <p className="mt-1.5 text-[13px] text-[#7a6a60]">Each day can be entered once. Forgot a day? Pick it here.</p>
      </section>
      <section className={card}>
        <div className={head}>Till (Z report)</div>
        <Row label="Z report total *"><Money value={v.z_report ?? ""} onChange={set("z_report")} /></Row>
        <Row label="Card"><Money value={v.card ?? ""} onChange={set("card")} /></Row>
        <Row label="Cash"><Money value={v.cash ?? ""} onChange={set("cash")} /></Row>
        <Row label="Tips"><Money value={v.tips ?? ""} onChange={set("tips")} /></Row>
      </section>
      <section className={card}>
        <div className={head}>Delivery platforms</div>
        <div className="space-y-2">
          {PLATFORMS.map((p) => (
            <div key={p.key} className="rounded-xl border border-[#eadfcc] p-2.5">
              <div className="mb-1.5 text-[15px] font-semibold">{p.label}</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[12px] text-[#7a6a60]">Sales<Money wide value={v[p.key] ?? ""} onChange={set(p.key)} /></label>
                <label className="text-[12px] text-[#7a6a60]">Commission<Money wide value={v[`${p.key}_commission`] ?? ""} onChange={set(`${p.key}_commission`)} /></label>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className={card}>
        <div className={head}>Cash drawer</div>
        <Row label="Opening cash"><Money value={v.opening_balance ?? ""} onChange={set("opening_balance")} /></Row>
        <Row label="Bank in (deposited / to owner)"><Money value={v.bank_in ?? ""} onChange={set("bank_in")} /></Row>
        <Row label="Cash counted at close"><Money value={v.closing_balance ?? ""} onChange={set("closing_balance")} /></Row>
      </section>
      <section className={card}>
        <div className={head}>Owed to us</div>
        <Row label="Pending bills"><Money value={v.pending ?? ""} onChange={set("pending")} /></Row>
      </section>
      <section className={card}>
        <ReceiptPhotos entity="daily_account" label="Z report photo (optional)" required={false} value={photos} onChange={setPhotos}
          uploadUrl={`/api/links/${token}/photo`} extraFields={{ pin }} big />
        {!pin && <p className="mt-1 text-[13px] text-[#7a6a60]">Enter your PIN before adding a photo.</p>}
      </section>
      <section className={card}>
        <div className={head}>Notes</div>
        <textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Anything unusual today"
          className="h-24 w-full resize-none rounded-xl border-[1.5px] border-[#eadfcc] bg-[#fffdf8] px-3 py-2.5 text-[16px]" />
      </section>
    </Shell>
  );
}

// ── Money In / Out ────────────────────────────────────────────────────────

export function CashForm({ token, business, today }: { token: string; business: string; today: string }) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [picks, setPicks] = useState<Picks>({ staff: [], suppliers: [], jobs: [] });
  const blank = { direction: "out" as "out" | "in", category: "", who: "", amount: "", reason: "", paidTo: "", date: today, method: "cash" as string };
  const [f, setF, clearDraft, savedAt] = useDraft(`cash:${token}`, blank);
  const [photos, setPhotos] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [askAgain, setAskAgain] = useState(false);
  const [done, setDone] = useState("");
  const cat = cashCategory(f.category);
  const upd = (patch: Partial<typeof blank>) => { setF((p) => ({ ...p, ...patch })); setAskAgain(false); };

  async function save() {
    setErr("");
    if (!pin) return setErr("Enter your PIN first.");
    if (!cat) return setErr("Choose what it was for.");
    if (cat.pick && !f.who) return setErr(cat.pick === "staff" ? "Choose the staff member." : cat.pick === "job" ? "Choose the job." : "Choose the supplier.");
    if (!(Number(f.amount) > 0)) return setErr("Enter the amount.");
    if (cat.reasonRequired && f.reason.trim().length < 3) return setErr("Write what it was for.");
    if (cat.direction === "out" && cat.photo && photos.length === 0) return setErr("Add a photo of the receipt.");
    setBusy(true);
    const res = await fetch(`/api/links/${token}/cash`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pin, category: cat.key, amount: f.amount, reason: f.reason, paid_to: f.paidTo, date: f.date, method: f.method, photo_ids: photos.map((p) => p.id),
        staff_member_id: cat.pick === "staff" ? Number(f.who) : undefined,
        supplier_id: cat.pick === "supplier" ? Number(f.who) : undefined,
        job_id: cat.pick === "job" ? Number(f.who) : undefined,
        confirm_duplicate: askAgain,
      }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => ({}));
    if (!res) return setErr("No connection. Your entry is still here. Tap Save again.");
    if (!res.ok) { setAskAgain(!!d?.duplicate); return setErr(d?.error ?? "Couldn't save. Please try again."); }
    setAskAgain(false);
    clearDraft();
    setDone(`${cat.label} £${Number(f.amount).toFixed(2)} (${PAY_METHODS.find((m) => m.key === f.method)?.label ?? "Cash"}), entered by ${name}.`);
  }

  const again = () => { setDone(""); setF({ ...blank, date: ukToday() }); setPhotos([]); setAskAgain(false); };
  if (done) return <Saved business={business} title="Money In / Out" what={done} again={again} />;
  const list = cat?.pick === "staff" ? picks.staff : cat?.pick === "job" ? picks.jobs : picks.suppliers;
  return (
    <Shell business={business} title={name ? `Money In / Out · ✓ ${name}` : "Money In / Out"} bar={<>
      {err && (askAgain
        ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-[15px] text-amber-900">{err}</div>
        : <NotSaved message={err} />)}
      <button onClick={save} disabled={busy || !cat} className={`${bigBtn} bg-[#e4473a] text-white`}>
        {busy ? "Saving…" : askAgain ? "Yes, a different one: save" : "Save"}
      </button>
    </>}>
      {savedAt && (f.category || f.amount) && <span className="inline-block rounded-full bg-[#fdf0c9] px-2.5 py-1 text-[11.5px] font-semibold text-[#8a6400]">Kept on this phone · {savedAt}</span>}
      <PinPad token={token} onOk={(p, n, pk) => { setPin(p); setName(n); setPicks(pk); }} />
      <div className="grid grid-cols-2 gap-2">
        {(["out", "in"] as const).map((d) => (
          <button key={d} onClick={() => upd({ direction: d, category: "", who: "" })}
            className={`h-14 rounded-2xl border-2 text-[16px] font-bold ${f.direction === d ? (d === "out" ? "border-[#e4473a] bg-red-50 text-[#e4473a]" : "border-emerald-600 bg-emerald-50 text-emerald-700") : "border-[#eadfcc] bg-white text-[#7a6a60]"}`}>
            {d === "out" ? "− Money OUT" : "+ Money IN"}
          </button>
        ))}
      </div>
      <section className={card}>
        <div className={head}>What was it for?</div>
        <div className="grid grid-cols-2 gap-2">
          {CASH_CATEGORIES.filter((c) => c.direction === f.direction && !c.hidden).map((c) => (
            <button key={c.key} onClick={() => upd({ category: c.key, who: "" })}
              className={`flex min-h-[56px] items-center gap-1.5 rounded-2xl border-2 px-2.5 py-2 text-left text-[14px] font-semibold leading-tight ${f.category === c.key ? "border-[#e4473a] bg-red-50" : "border-[#eadfcc] bg-white"}`}>
              <span>{c.icon}</span><span>{c.label}</span>
            </button>
          ))}
        </div>
      </section>
      {cat && (
        <>
          {CATEGORY_HINT[cat.key] && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900">ℹ️ {CATEGORY_HINT[cat.key]}</p>
          )}
          <section className={card}>
            <div className={head}>Paid how?</div>
            <div className="grid grid-cols-3 gap-2">
              {PAY_METHODS.map((m) => (
                <button key={m.key} onClick={() => upd({ method: m.key })}
                  className={`flex min-h-[56px] flex-col items-center justify-center rounded-2xl border-2 text-[14px] font-semibold leading-tight ${f.method === m.key ? "border-[#e4473a] bg-red-50" : "border-[#eadfcc] bg-white"}`}>
                  <span className="text-[18px]">{m.icon}</span>{m.label}
                </button>
              ))}
            </div>
            {f.method !== "cash" && <p className="mt-2 text-[13px] text-[#7a6a60]">Not cash, so it doesn't count in the cash drawer.</p>}
          </section>
          {cat.pick && (
            <section className={card}>
              <div className={head}>{cat.pick === "staff" ? "Staff member" : cat.pick === "job" ? "Which job?" : "Supplier"}</div>
              {!pin ? <p className="text-[15px] text-[#7a6a60]">Enter your PIN to see the list.</p> : cat.pick === "job" && list.length === 0 ? (
                <p className="text-[15px] text-[#7a6a60]">No catering or event is waiting for payment. A manager adds jobs in Daily accounts → Catering &amp; events.</p>
              ) : (
                <select value={f.who} onChange={(e) => upd({ who: e.target.value })} className="h-12 w-full rounded-xl border-[1.5px] border-[#eadfcc] bg-[#fffdf8] px-3 text-[16px]">
                  <option value="">Choose…</option>
                  {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
            </section>
          )}
          <section className={card}>
            <div className={head}>Amount</div>
            <div className="flex h-[72px] items-center rounded-2xl border-[1.5px] border-[#eadfcc] bg-[#fffdf8] px-4 focus-within:border-[#e4473a]">
              <span className="text-[26px] font-bold text-[#7a6a60]">£</span>
              <input value={f.amount} onChange={(e) => upd({ amount: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" placeholder="0.00"
                className="w-full bg-transparent text-center text-[34px] font-bold outline-none" />
            </div>
          </section>
          <section className={card}>
            <div className={head}>{cat.reasonRequired ? "What was it for? *" : "Note (optional)"}</div>
            <textarea value={f.reason} onChange={(e) => upd({ reason: e.target.value })} placeholder={cat.reasonRequired ? "Say what it was" : "e.g. what was bought"}
              className="h-20 w-full resize-none rounded-xl border-[1.5px] border-[#eadfcc] bg-[#fffdf8] px-3 py-2.5 text-[16px]" />
            {!cat.pick && cat.home !== "book" && (
              <Row label="Paid to (optional)">
                <input value={f.paidTo} onChange={(e) => upd({ paidTo: e.target.value })} className="h-12 w-40 rounded-xl border-[1.5px] border-[#eadfcc] bg-[#fffdf8] px-3 text-[16px]" />
              </Row>
            )}
            <Row label="Date">
              <span className="w-44"><DateBox value={f.date} max={today} onChange={(d) => upd({ date: d })} /></span>
            </Row>
          </section>
          {(cat.photo || cat.direction === "out") && (
            <section className={card}>
              <ReceiptPhotos entity="cash_movement" label={cat.photo ? "Receipt photo" : "Photo (optional)"} required={cat.photo} value={photos} onChange={setPhotos}
                uploadUrl={`/api/links/${token}/photo`} extraFields={{ pin }} big />
              {!pin && <p className="mt-1 text-[13px] text-[#7a6a60]">Enter your PIN before adding a photo.</p>}
            </section>
          )}
        </>
      )}
    </Shell>
  );
}
