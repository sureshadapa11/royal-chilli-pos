"use client";

import { useCallback, useEffect, useState } from "react";
import type { BusinessSummary } from "@/lib/businesses-admin";
import { freshStart } from "@/lib/auth-sync";

const card = "rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-5";
const input = "w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm";
const btn = "rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground hover:bg-surface-hover disabled:opacity-60";

// The group owner's Businesses screen: every business, add one, open / close
// it, jump in to work or set it up.
export default function BusinessesView({ current }: { current: number }) {
  const [list, setList] = useState<BusinessSummary[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", order_prefix: "", login_code: "" });
  const [formError, setFormError] = useState<{ field?: string; text: string } | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/businesses");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error || "Couldn't load businesses");
    setList(d.businesses);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function workIn(id: number, then: string) {
    setBusy(`switch-${id}`);
    const res = await fetch("/api/auth/switch-business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: id }) });
    setBusy(null);
    if (!res.ok) return setError("Couldn't switch business");
    freshStart(then);
  }

  async function setOpen(id: number, active: boolean) {
    setBusy(`open-${id}`);
    const res = await fetch(`/api/businesses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    setConfirmOpen(null);
    if (!res.ok) return setError(d.error || "Couldn't update the business");
    setNotice(active ? "Business opened" : "Business closed");
    load();
  }

  async function copyRewards(id: number) {
    setBusy(`rewards-${id}`);
    const res = await fetch(`/api/businesses/${id}/copy-rewards`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(d.error || "Couldn't copy the rewards scheme");
    setNotice(`Copied ${d.tiers} tiers, ${d.rewards} rewards and ${d.rules} points rules from The Royal Chilli`);
    load();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy("add");
    const res = await fetch("/api/businesses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setFormError({ field: d.field, text: d.error || "Couldn't add the business" });
    setForm({ name: "", order_prefix: "", login_code: "" });
    setNotice(`${d.business ? form.name : "Business"} added — not open yet. Set it up next.`);
    load();
  }

  if (error && !list) return <p className="py-6 text-sm text-red-600">{error}</p>;
  if (!list) return <p className="py-6 text-sm text-muted-foreground">Loading businesses…</p>;

  return (
    <div className="space-y-5">
      {(notice || error) && (
        <p role="status" className={`text-sm font-semibold ${error ? "text-red-600" : "text-emerald-600"}`}>{error || `✓ ${notice}`}</p>
      )}

      <div className="space-y-3">
        {list.map((b) => (
          <article key={b.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-foreground">
                  {b.name}
                  <span className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[11px] font-semibold ${b.active ? "bg-emerald-50 text-emerald-700" : "bg-surface-hover text-muted-foreground"}`}>
                    {b.active ? "Open" : "Not open yet"}
                  </span>
                  {b.id === current && <span className="ml-2 align-middle text-[11px] text-muted-foreground">working in</span>}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Orders {b.order_prefix ?? "—"}-… · {b.staff} staff · {b.customers} customers · {b.dishes} dishes
                  {b.domain ? ` · ${b.domain}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn} disabled={!!busy} onClick={() => workIn(b.id, "/staff")}>Work in</button>
                <button type="button" className={btn} disabled={!!busy} onClick={() => workIn(b.id, "/staff/settings?tab=setup")}>Set up</button>
                {!b.hasRewards && (
                  <button type="button" className={btn} disabled={!!busy} onClick={() => copyRewards(b.id)}>Copy Royal Chilli&apos;s rewards</button>
                )}
                {b.id !== 1 && (b.active ? (
                  <button type="button" className={btn} disabled={!!busy} onClick={() => setOpen(b.id, false)}>Close</button>
                ) : (
                  <button type="button" className={`${btn} border-red-200 text-red-700`} disabled={!!busy} onClick={() => setConfirmOpen(b.id)}>Open for business</button>
                ))}
              </div>
            </div>
            {confirmOpen === b.id && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-semibold">Open {b.name}?</p>
                <p className="mt-1 text-xs">
                  Its QR links and website ordering start working. Finish its Business setup (name, address, VAT, payments) and
                  its menu, staff and printer first.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500" onClick={() => setOpen(b.id, true)}>Yes, open it</button>
                  <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-white" onClick={() => setConfirmOpen(null)}>Cancel</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      <form onSubmit={add} className={card}>
        <h2 className="text-lg font-bold text-foreground">Add a business</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          It starts closed, with every part switched on and a copy of Royal Chilli&apos;s rewards scheme. Nothing else is shared — it gets its own staff, menu, customers and suppliers.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px_150px_auto] sm:items-end">
          <div>
            <label htmlFor="new-business-name" className="mb-1 block text-xs text-muted-foreground">Trading name</label>
            <input id="new-business-name" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Melt House Richmond" />
            {formError?.field === "name" && <p className="mt-1 text-xs text-red-600">{formError.text}</p>}
          </div>
          <div>
            <label htmlFor="new-business-prefix" className="mb-1 block text-xs text-muted-foreground">Order number prefix</label>
            <input id="new-business-prefix" className={input} value={form.order_prefix} maxLength={4}
              onChange={(e) => setForm({ ...form, order_prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="e.g. MR" />
            {formError?.field === "order_prefix" && <p className="mt-1 text-xs text-red-600">{formError.text}</p>}
          </div>
          <div>
            <label htmlFor="new-business-code" className="mb-1 block text-xs text-muted-foreground">Business code (staff sign-in)</label>
            <input id="new-business-code" className={input} value={form.login_code} maxLength={8}
              onChange={(e) => setForm({ ...form, login_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="e.g. MR" />
            {formError?.field === "login_code" && <p className="mt-1 text-xs text-red-600">{formError.text}</p>}
          </div>
          <button type="submit" disabled={busy === "add"} className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60">
            {busy === "add" ? "Adding…" : "Add business"}
          </button>
        </div>
        {formError && !formError.field && <p className="mt-2 text-xs text-red-600">{formError.text}</p>}
      </form>
    </div>
  );
}
