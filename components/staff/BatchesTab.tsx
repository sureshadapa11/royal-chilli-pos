"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { STORAGE_KIND_LABEL, STORAGE_KINDS, type ExpiryStatus, type StorageKind } from "@/lib/batches";

// Inventory → Batches & expiry (inventory v2 phase 3, agreed 2026-10-08).
// Dated stock by use-by: past it = red "Expired" with one-tap "Bin it",
// today/tomorrow = amber "Use first". Managers keep the branch's list of
// fridges, freezers and stores here too.

type Area = { id: number; name: string; kind: StorageKind };
type Batch = {
  id: number; name: string; unit: string; storage_area_id: number | null; expiry_date: string;
  received_qty: number; remaining_qty: number; received_at: string; order_number: string | null; supplier_name: string | null; status: ExpiryStatus;
};

const btn = "px-3 py-1.5 text-xs font-bold rounded-lg";
const btnPlain = `${btn} bg-surface-hover hover:bg-elevated text-foreground border border-border`;
const input = "bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-foreground text-sm min-w-0";
const qty = (n: number) => Math.round(Number(n) * 1000) / 1000;

function dayLabel(expiry: string, today: string): string {
  const days = Math.round((Date.parse(expiry + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86_400_000);
  const date = new Date(expiry + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (days === 0) return `${date} · today`;
  if (days === 1) return `${date} · tomorrow`;
  if (days === -1) return `${date} · yesterday`;
  return days < 0 ? `${date} · ${-days} days ago` : `${date} · in ${days} days`;
}

const SECTION: Record<ExpiryStatus, { title: string; box: string; pill: string; label: string }> = {
  expired: { title: "Expired", box: "border-red-300 bg-red-50/60", pill: "bg-red-100 text-red-700", label: "Expired" },
  use_first: { title: "Use first", box: "border-amber-300 bg-amber-50/60", pill: "bg-amber-100 text-amber-800", label: "Use first" },
  ok: { title: "Later", box: "border-border bg-surface", pill: "bg-surface-hover text-muted-foreground", label: "OK" },
};

export default function BatchesTab() {
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [today, setToday] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [filter, setFilter] = useState<number | "all" | "none">("all");
  const [confirmBin, setConfirmBin] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [b, a] = await Promise.all([
      fetch("/api/batches").then((r) => r.json()).catch(() => ({})),
      fetch("/api/storage-areas").then((r) => r.json()).catch(() => ({})),
    ]);
    setBatches(b.batches || []);
    setToday(b.today || "");
    setAreas(a.areas || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => batches.filter((b) =>
    filter === "all" ? true : filter === "none" ? b.storage_area_id == null : b.storage_area_id === filter), [batches, filter]);

  async function bin(b: Batch) {
    setBusy(b.id);
    const res = await fetch(`/api/batches/${b.id}`, { method: "POST" }).catch(() => null);
    setBusy(null); setConfirmBin(null);
    const data = res ? await res.json().catch(() => ({})) : { error: "No connection. Check the Wi-Fi and try again." };
    if (!res?.ok) return toast({ variant: "destructive", title: "Couldn't bin it", description: data.error });
    toast({ variant: "success", title: `Binned ${qty(data.quantity)} ${b.unit} ${b.name}`, description: "Recorded as waste (expired)." });
    load();
  }

  async function move(b: Batch, areaId: string) {
    setBusy(b.id);
    const res = await fetch(`/api/batches/${b.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storage_area_id: areaId || null }),
    }).catch(() => null);
    setBusy(null);
    const data = res ? await res.json().catch(() => ({})) : { error: "No connection." };
    if (!res?.ok) return toast({ variant: "destructive", title: "Couldn't move it", description: data.error });
    load();
  }

  return (
    <div className="space-y-5">
      <StorageAreas areas={areas} onChange={load} />

      {areas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {([["all", "All"], ...areas.map((a) => [a.id, a.name]), ["none", "No area"]] as [number | "all" | "none", string][]).map(([v, label]) => (
            <button key={String(v)} onClick={() => setFilter(v)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${filter === v ? "bg-foreground text-background border-foreground" : "bg-surface border-border text-foreground"}`}>{label}</button>
          ))}
        </div>
      )}

      {shown.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8">No dated stock{filter !== "all" ? " here" : ""}. A delivery line received with a use-by date shows up here.</p>
      )}

      {(["expired", "use_first", "ok"] as ExpiryStatus[]).map((status) => {
        const list = shown.filter((b) => b.status === status);
        if (!list.length) return null;
        const s = SECTION[status];
        return (
          <section key={status} className="space-y-2">
            <h2 className="text-foreground font-bold">{s.title} <span className="text-muted-foreground font-normal text-sm">({list.length})</span></h2>
            {list.map((b) => (
              <div key={b.id} className={`rounded-lg border px-4 py-3 flex items-center justify-between flex-wrap gap-2 ${s.box}`}>
                <div className="min-w-0">
                  <p className="text-foreground font-semibold">{b.name} · {qty(b.remaining_qty)} {b.unit} <span className="text-muted-foreground font-normal text-sm">of {qty(b.received_qty)}</span></p>
                  <p className="text-sm text-foreground">Use by {dayLabel(b.expiry_date, today)}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.supplier_name ?? "—"}{b.order_number ? ` · ${b.order_number}` : ""} · in {new Date(b.received_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.pill}`}>{s.label}</span>
                  <select value={b.storage_area_id ?? ""} disabled={busy === b.id} onChange={(e) => move(b, e.target.value)} className={input} aria-label={`Where ${b.name} is kept`}>
                    <option value="">No area</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  {status === "expired" && (confirmBin === b.id ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-red-700 font-semibold">Bin {qty(b.remaining_qty)} {b.unit}?</span>
                      <button disabled={busy === b.id} onClick={() => bin(b)} className={`${btn} bg-red-600 hover:bg-red-500 text-white`}>Yes, bin it</button>
                      <button onClick={() => setConfirmBin(null)} className={btnPlain}>No</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmBin(b.id)} className={`${btn} bg-red-600 hover:bg-red-500 text-white`}>Bin it</button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ── The branch's fridges, freezers and stores ───────────────────────────────
function StorageAreas({ areas, onChange }: { areas: Area[]; onChange: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StorageKind>("fridge");
  const [confirm, setConfirm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim() || saving) return;
    setSaving(true);
    const res = await fetch("/api/storage-areas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind }) }).catch(() => null);
    setSaving(false);
    const data = res ? await res.json().catch(() => ({})) : { error: "No connection." };
    if (!res?.ok) return toast({ variant: "destructive", title: "Couldn't add it", description: data.error });
    setName("");
    onChange();
  }

  async function remove(a: Area) {
    const res = await fetch(`/api/storage-areas/${a.id}`, { method: "DELETE" }).catch(() => null);
    setConfirm(null);
    const data = res ? await res.json().catch(() => ({})) : { error: "No connection." };
    if (!res?.ok) return toast({ variant: "destructive", title: `Couldn't remove ${a.name}`, description: data.error });
    toast({ variant: "success", title: `${a.name} removed` });
    onChange();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div>
        <h2 className="text-foreground font-bold">Fridges, freezers &amp; stores</h2>
        <p className="text-muted-foreground text-xs mt-0.5">Where dated stock is kept in this branch. Pick one when you receive a delivery.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {areas.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-hover pl-3 pr-1 py-1 text-sm text-foreground">
            {a.name} <span className="text-muted-foreground text-xs">{STORAGE_KIND_LABEL[a.kind]}</span>
            {confirm === a.id ? (
              <>
                <button onClick={() => remove(a)} className="text-xs font-bold text-red-700 px-1.5">Remove</button>
                <button onClick={() => setConfirm(null)} className="text-xs text-muted-foreground px-1.5">Keep</button>
              </>
            ) : (
              <button aria-label={`Remove ${a.name}`} onClick={() => setConfirm(a.id)} className="w-6 h-6 rounded-full text-muted-foreground hover:text-red-600">×</button>
            )}
          </span>
        ))}
        {areas.length === 0 && <span className="text-muted-foreground text-sm">None yet.</span>}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="e.g. Walk-in fridge" maxLength={40} className={`${input} w-48`} aria-label="New storage area name" />
        <select value={kind} onChange={(e) => setKind(e.target.value as StorageKind)} className={input} aria-label="Kind">
          {STORAGE_KINDS.map((k) => <option key={k} value={k}>{STORAGE_KIND_LABEL[k]}</option>)}
        </select>
        <button onClick={add} disabled={!name.trim() || saving} className={`${btn} bg-red-600 hover:bg-red-500 text-white disabled:opacity-50`}>Add</button>
      </div>
    </section>
  );
}
