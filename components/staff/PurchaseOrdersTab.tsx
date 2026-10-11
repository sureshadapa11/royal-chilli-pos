"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import ReceiptPhotos, { ReceiptLinks, type Receipt } from "@/components/staff/ReceiptPhotos";
import { needsApproval, PO_STATUS_LABEL, REJECTION_LABEL, REJECTION_REASONS, type PoStatus, type RejectionReason } from "@/lib/purchase-orders";

// Inventory → Purchase Orders (inventory v2 phase 1, agreed 2026-10-08):
// "What to order" from reorder levels, orders over the approval limit approved
// by someone else, drafts editable, today's price typed on every order, the
// invoice price entered at Receive, and a history for each order.

type Ingredient = { id: number; name: string; unit: string; supplier_id: number | null };
type Supplier = { id: number; name: string };
type PO = {
  id: number; order_number: string; supplier_id: number; supplier_name: string | null; status: PoStatus;
  order_date: string; total_cost: number; created_by_name: string | null; can_approve: boolean; reject_reason: string | null;
  short_delivery?: boolean;
};
type SuggestLine = { ingredient_id: number; name: string; unit: string; supplier_id: number | null; current_stock: number; reorder_level: number; on_order: number; quantity: number };
type LastPaid = Record<number, { price: number; date: string | null }>;
type DraftLine = { ingredient_id: number; quantity: string; unit_cost: string };
type OrderDraft = { mode: "new" | "edit" | "copy"; poId?: number; supplierId: number | null; lines: DraftLine[] };

const money = (n: number) => `£${Number(n).toFixed(2)}`;
const shortDate = (d: string | null) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

const STATUS_CLASS: Record<PoStatus, string> = {
  draft: "bg-surface-hover text-muted-foreground",
  awaiting_approval: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-700",
  ordered: "bg-blue-100 text-blue-700",
  received: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-surface-hover text-muted-foreground",
};

const EVENT_LABEL: Record<string, string> = {
  created: "Created", edited: "Lines changed", submitted: "Sent for approval", auto_approved: "Approved automatically",
  approved: "Approved", rejected: "Rejected", sent: "Marked sent to supplier", received: "Received", cancelled: "Cancelled",
};

const btn = "px-3 py-1.5 text-xs font-bold rounded-lg";
const btnPlain = `${btn} bg-surface-hover hover:bg-elevated text-foreground border border-border`;
const btnRed = `${btn} bg-red-600 hover:bg-red-500 text-white`;
const btnGreen = `${btn} bg-emerald-700 hover:bg-emerald-600 text-white`;
const input = "bg-surface-hover border border-border rounded-lg px-2 py-1.5 text-foreground text-sm min-w-0";
const overlay = "fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4";
const panel = "bg-surface border border-border rounded-2xl w-full max-h-[90vh] overflow-y-auto p-5";

export default function PurchaseOrdersTab({ suppliers, ingredients }: { suppliers: Supplier[]; ingredients: Ingredient[] }) {
  const { toast } = useToast();
  const [pos, setPos] = useState<PO[]>([]);
  const [photos, setPhotos] = useState<Record<string, { id: number }[]>>({});
  const [suggest, setSuggest] = useState<SuggestLine[]>([]);
  const [lastPaid, setLastPaid] = useState<LastPaid>({});
  const [limit, setLimit] = useState({ approvalLimit: 150, canChange: false });
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [receiving, setReceiving] = useState<number | null>(null);
  const [history, setHistory] = useState<number | null>(null);
  const [ask, setAsk] = useState<{ title: string; hint: string; required: boolean; initial?: string; numeric?: boolean; onOk: (v: string) => Promise<void> } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [list, sug, set] = await Promise.all([
      fetch("/api/purchase-orders").then((r) => r.json()).catch(() => ({})),
      fetch("/api/purchase-orders/suggest").then((r) => r.json()).catch(() => ({})),
      fetch("/api/purchase-orders/settings").then((r) => r.json()).catch(() => ({})),
    ]);
    const orders: PO[] = list.purchaseOrders || [];
    setPos(orders);
    setSuggest(sug.lines || []);
    setLastPaid(sug.lastPaid || {});
    if (typeof set.approvalLimit === "number") setLimit({ approvalLimit: set.approvalLimit, canChange: !!set.canChange });
    const received = orders.filter((po) => po.status === "received").map((po) => po.id).slice(0, 500);
    if (received.length) {
      const r = await fetch(`/api/receipts?entity=purchase_order&ids=${received.join(",")}`);
      if (r.ok) setPhotos((await r.json()).receipts || {});
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const supplierName = useCallback((id: number | null) => suppliers.find((s) => s.id === id)?.name ?? "No supplier set", [suppliers]);
  const groups = useMemo(() => {
    const m = new Map<number | null, SuggestLine[]>();
    for (const l of suggest) m.set(l.supplier_id, [...(m.get(l.supplier_id) ?? []), l]);
    return [...m.entries()].sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : supplierName(a).localeCompare(supplierName(b))));
  }, [suggest, supplierName]);

  async function act(po: PO, action: string, comment?: string) {
    setBusy(po.id);
    const res = await fetch(`/api/purchase-orders/${po.id}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, comment }),
    }).catch(() => null);
    setBusy(null);
    const data = res ? await res.json().catch(() => ({})) : { error: "No connection. Check the Wi-Fi and try again." };
    if (!res?.ok) { toast({ variant: "destructive", title: "Couldn't update the order", description: data.error }); return false; }
    const status = data.purchaseOrder?.status as PoStatus | undefined;
    toast({ variant: "success", title: `${po.order_number}: ${status ? PO_STATUS_LABEL[status] : "updated"}` });
    load();
    return true;
  }

  function startFromSuggestion(supplierId: number, lines: SuggestLine[]) {
    const picked = lines.filter((l) => !unticked.has(l.ingredient_id));
    if (!picked.length) return toast({ variant: "destructive", title: "Tick at least one item" });
    setDraft({ mode: "new", supplierId, lines: picked.map((l) => ({ ingredient_id: l.ingredient_id, quantity: String(l.quantity), unit_cost: "" })) });
  }

  async function startFromOrder(po: PO, mode: "edit" | "copy") {
    const data = await fetch(`/api/purchase-orders/${po.id}`).then((r) => r.json()).catch(() => null);
    if (!data?.items) return toast({ variant: "destructive", title: "Couldn't open the order" });
    setDraft({
      mode, poId: mode === "edit" ? po.id : undefined, supplierId: po.supplier_id,
      lines: data.items.map((i: { ingredient_id: number; quantity: number; unit_cost: number }) => ({
        ingredient_id: i.ingredient_id, quantity: String(Number(i.quantity)),
        // A copy is a new order on a new day: type today's price again.
        unit_cost: mode === "edit" ? String(Number(i.unit_cost)) : "",
      })),
    });
  }

  return (
    <div className="space-y-5">
      {/* What to order */}
      <section className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div>
          <h2 className="text-foreground font-bold">What to order {suggest.length > 0 && <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">{suggest.length}</span>}</h2>
          <p className="text-muted-foreground text-xs mt-0.5">Items at or below their reorder level, less what&apos;s already on order, by supplier. Tick what you want and create the order — you can change it before placing it.</p>
        </div>
        {groups.length === 0 && <p className="text-muted-foreground text-sm">Nothing is low right now.</p>}
        {groups.map(([supplierId, lines]) => (
          <div key={supplierId ?? "none"} className="border-t border-dashed border-border pt-3 first:border-t-0 first:pt-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-foreground font-semibold text-sm">{supplierName(supplierId)}</span>
              {supplierId == null
                ? <span className="text-muted-foreground text-xs">Set a supplier on these ingredients first</span>
                : <button onClick={() => startFromSuggestion(supplierId, lines)} className={btnRed}>Create order</button>}
            </div>
            {lines.map((l) => (
              <label key={l.ingredient_id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox" className="mt-1" disabled={supplierId == null}
                  checked={!unticked.has(l.ingredient_id)}
                  onChange={(e) => setUnticked((prev) => { const n = new Set(prev); if (e.target.checked) n.delete(l.ingredient_id); else n.add(l.ingredient_id); return n; })}
                />
                <span className="min-w-0">
                  <span className="text-foreground font-semibold">{l.name}</span> <span className="text-foreground">· {l.quantity} {l.unit}</span>
                  <span className="text-muted-foreground text-xs"> — {Number(l.current_stock)} {l.unit} left, reorder at {Number(l.reorder_level)}{l.on_order > 0 ? `, ${l.on_order} on order` : ""}</span>
                </span>
              </label>
            ))}
          </div>
        ))}
      </section>

      {/* Approval limit */}
      <div className="flex items-center gap-2 flex-wrap text-sm text-foreground">
        <span>Orders over <b>{money(limit.approvalLimit)}</b> need approving by another manager or a Super admin.</span>
        {limit.canChange
          ? <button className={btnPlain} onClick={() => setAsk({
              title: "Approval limit (£)", hint: "e.g. 150", required: true, numeric: true, initial: String(limit.approvalLimit),
              onOk: async (v) => {
                const res = await fetch("/api/purchase-orders/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approval_limit: Number(v) }) });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) { toast({ variant: "destructive", title: "Couldn't save", description: data.error }); return; }
                toast({ variant: "success", title: `Approval limit: ${money(data.approvalLimit)}` });
                load();
              },
            })}>Change</button>
          : <span className="text-muted-foreground text-xs">(Only a Super admin can change this.)</span>}
      </div>

      {/* Orders */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-foreground font-bold">Purchase orders</h2>
          <button onClick={() => setDraft({ mode: "new", supplierId: null, lines: [{ ingredient_id: 0, quantity: "", unit_cost: "" }] })} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">+ New order</button>
        </div>
        {pos.map((po) => {
          const open = ["draft", "awaiting_approval", "approved", "ordered"].includes(po.status);
          const overLimit = needsApproval(Number(po.total_cost), limit.approvalLimit) && !limit.canChange;
          const disabled = busy === po.id;
          return (
            <div key={po.id} className="rounded-lg border border-border bg-surface px-4 py-3 flex items-center justify-between flex-wrap gap-2">
              <div className="min-w-0">
                <p className="text-foreground font-semibold">{po.order_number} · {po.supplier_name}</p>
                <p className="text-muted-foreground text-sm">{shortDate(po.order_date)} · {money(po.total_cost)}{po.created_by_name ? ` · by ${po.created_by_name}` : ""}</p>
                {po.status === "rejected" && po.reject_reason && <p className="text-red-700 text-xs mt-0.5">“{po.reject_reason}”</p>}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {po.status === "received" && <ReceiptLinks photos={photos[po.id]} />}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[po.status] ?? STATUS_CLASS.draft}`}>{PO_STATUS_LABEL[po.status] ?? po.status}</span>
                {po.status === "received" && po.short_delivery && (
                  <button onClick={() => setHistory(po.id)} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800" title="What was short or refused">Short delivery</button>
                )}
                {po.status === "draft" && <>
                  <button disabled={disabled} onClick={() => startFromOrder(po, "edit")} className={btnPlain}>Edit</button>
                  <button disabled={disabled} onClick={() => act(po, "submit")} className={btnRed}>{overLimit ? "Send for approval" : "Place order"}</button>
                </>}
                {po.status === "awaiting_approval" && (po.can_approve ? <>
                  <button disabled={disabled} onClick={() => act(po, "approve")} className={btnGreen}>Approve</button>
                  <button disabled={disabled} onClick={() => setAsk({ title: `Reject ${po.order_number}`, hint: "Why? The person who ordered sees this.", required: true, onOk: async (v) => { await act(po, "reject", v); } })} className={btnPlain}>Reject</button>
                </> : <span className="text-muted-foreground text-xs">Waiting for another manager or a Super admin</span>)}
                {po.status === "approved" && <button disabled={disabled} onClick={() => act(po, "mark_sent")} className={btnPlain}>Mark sent to supplier</button>}
                {(po.status === "approved" || po.status === "ordered") && <button disabled={disabled} onClick={() => setReceiving(po.id)} className={btnGreen}>Receive</button>}
                {open && <button disabled={disabled} onClick={() => setAsk({ title: `Cancel ${po.order_number}?`, hint: "Reason (optional)", required: false, onOk: async (v) => { await act(po, "cancel", v || undefined); } })} className={btnPlain}>Cancel</button>}
                {(po.status === "rejected" || po.status === "cancelled") && <button onClick={() => startFromOrder(po, "copy")} className={btnPlain}>Copy to new order</button>}
                <button onClick={() => setHistory(po.id)} className={`${btn} text-muted-foreground hover:text-foreground`}>History</button>
              </div>
            </div>
          );
        })}
        {pos.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No purchase orders yet.</p>}
      </section>

      {draft && (
        <OrderModal
          draft={draft} suppliers={suppliers} ingredients={ingredients} lastPaid={lastPaid}
          limit={limit.approvalLimit} superAdmin={limit.canChange}
          onClose={() => setDraft(null)} onSaved={() => { setDraft(null); setUnticked(new Set()); load(); }}
        />
      )}
      {receiving != null && <ReceivePoModal poId={receiving} onClose={() => setReceiving(null)} onSaved={load} />}
      {history != null && <HistoryModal poId={history} onClose={() => setHistory(null)} />}
      {ask && <AskModal {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ── New / edit / copy an order ──────────────────────────────────────────────
function OrderModal({ draft, suppliers, ingredients, lastPaid, limit, superAdmin, onClose, onSaved }: {
  draft: OrderDraft; suppliers: Supplier[]; ingredients: Ingredient[]; lastPaid: LastPaid; limit: number; superAdmin: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState<number | null>(draft.supplierId);
  const [lines, setLines] = useState<DraftLine[]>(draft.lines);
  const [saving, setSaving] = useState(false);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  // This supplier's ingredients first.
  const options = useMemo(() => [...ingredients].sort((a, b) =>
    Number(b.supplier_id === supplierId) - Number(a.supplier_id === supplierId) || a.name.localeCompare(b.name)), [ingredients, supplierId]);

  const total = lines.reduce((s, l) => s + (num(l.quantity) || 0) * (num(l.unit_cost) || 0), 0);
  const needs = needsApproval(total, limit) && !superAdmin;
  const missingPrice = lines.some((l) => l.ingredient_id > 0 && !(num(l.unit_cost) > 0));
  const set = (i: number, patch: Partial<DraftLine>) => setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function save(submit: boolean) {
    if (!supplierId) return toast({ variant: "destructive", title: "Pick a supplier" });
    const filled = lines.filter((l) => l.ingredient_id > 0);
    if (!filled.length) return toast({ variant: "destructive", title: "Add at least one item" });
    if (filled.some((l) => !(num(l.quantity) > 0))) return toast({ variant: "destructive", title: "Enter a quantity on every line" });
    if (filled.some((l) => !(num(l.unit_cost) > 0))) return toast({ variant: "destructive", title: "Enter today's price on every line", description: "Supplier prices change — check the price with the supplier." });
    if (new Set(filled.map((l) => l.ingredient_id)).size !== filled.length) return toast({ variant: "destructive", title: "Same item on two lines", description: "Put it on one line with the total quantity." });
    const items = filled.map((l) => ({ ingredient_id: l.ingredient_id, quantity: num(l.quantity), unit_cost: num(l.unit_cost) }));

    setSaving(true);
    try {
      let res: Response;
      if (draft.mode === "edit" && draft.poId) {
        res = await fetch(`/api/purchase-orders/${draft.poId}/items`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
        if (res.ok && submit) {
          res = await fetch(`/api/purchase-orders/${draft.poId}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit" }) });
        }
      } else {
        res = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplier_id: supplierId, items, submit }) });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast({ variant: "destructive", title: "Couldn't save the order", description: data.error });
      const status = data.purchaseOrder?.status as PoStatus | undefined;
      toast({
        variant: "success",
        title: status === "awaiting_approval" ? "Sent for approval" : status === "approved" ? "Order approved — mark it sent once you've ordered" : "Saved as a draft",
      });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Couldn't save the order", description: "No connection. Check the Wi-Fi and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={overlay}>
      <div className={`${panel} max-w-2xl`}>
        <h2 className="text-foreground font-bold text-lg">{draft.mode === "edit" ? "Edit draft" : draft.mode === "copy" ? "New order (copy)" : "New order"}</h2>
        <select value={supplierId ?? ""} disabled={draft.mode === "edit"} onChange={(e) => setSupplierId(Number(e.target.value) || null)} className={`${input} mt-3 w-full`}>
          <option value="">Select supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="mt-4 space-y-3">
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_80px_96px_70px_24px] gap-2 text-xs text-muted-foreground">
            <span>Item</span><span>Qty</span><span>Today&apos;s £ / unit</span><span className="text-right">Line</span><span />
          </div>
          {lines.map((l, i) => {
            const ing = byId.get(l.ingredient_id);
            const paid = l.ingredient_id ? lastPaid[l.ingredient_id] : undefined;
            const lineTotal = (num(l.quantity) || 0) * (num(l.unit_cost) || 0);
            return (
              <div key={i} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_70px_86px_24px] sm:grid-cols-[minmax(0,1fr)_80px_96px_70px_24px] gap-2 items-center">
                  <select value={l.ingredient_id} onChange={(e) => set(i, { ingredient_id: Number(e.target.value) })} className={input}>
                    <option value={0}>Item…</option>
                    {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.unit})</option>)}
                  </select>
                  <input type="number" inputMode="decimal" min="0" step="0.01" placeholder={ing?.unit ?? "Qty"} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className={input} />
                  <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="£" value={l.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} className={`${input} ${l.unit_cost === "" && l.ingredient_id ? "border-amber-400" : ""}`} />
                  <span className="hidden sm:block text-right text-sm text-foreground tabular-nums">{lineTotal ? money(lineTotal) : "—"}</span>
                  <button aria-label="Remove line" onClick={() => setLines((prev) => prev.filter((_, k) => k !== i))} className="text-muted-foreground hover:text-red-600 text-lg leading-none">×</button>
                </div>
                {paid && (
                  <p className="text-xs text-muted-foreground">
                    Last paid {money(paid.price)}{paid.date ? ` on ${shortDate(paid.date)}` : ""} ·{" "}
                    <button type="button" onClick={() => set(i, { unit_cost: String(paid.price) })} className="text-red-600 font-semibold">use it</button>
                  </p>
                )}
              </div>
            );
          })}
          <button onClick={() => setLines((prev) => [...prev, { ingredient_id: 0, quantity: "", unit_cost: "" }])} className="text-red-600 text-xs font-semibold">+ Add line</button>
        </div>

        <p className="mt-3 text-right text-foreground font-semibold tabular-nums">Total {money(total)}</p>
        {missingPrice && !needs ? (
          <p className="mt-2 rounded-lg px-3 py-2 text-sm font-semibold bg-surface-hover text-muted-foreground">Enter today&apos;s price on every line to see if it needs approval.</p>
        ) : (
          <p className={`mt-2 rounded-lg px-3 py-2 text-sm font-semibold ${needs ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
            {needs ? `Over ${money(limit)} — this goes to another manager or a Super admin to approve.` : superAdmin && needsApproval(total, limit) ? "Super admin — approved straight away." : `Within ${money(limit)} — approved straight away.`}
          </p>
        )}

        <div className="mt-4 flex gap-2 flex-wrap justify-end">
          <button onClick={onClose} className="h-10 px-4 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Close</button>
          <button disabled={saving} onClick={() => save(false)} className="h-10 px-4 bg-surface-hover border border-border text-foreground font-semibold rounded-xl disabled:opacity-50">{draft.mode === "edit" ? "Save changes" : "Save as draft"}</button>
          <button disabled={saving} onClick={() => save(true)} className="h-10 px-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl disabled:opacity-50">{saving ? "Saving…" : needs ? "Send for approval" : "Place order"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Receive a delivery ──────────────────────────────────────────────────────
// One delivery closes the order (agreed 2026-10-08): what didn't come or was
// refused is the shortfall, kept in the history — nothing waits for the rest.
type ReceiveLine = {
  id: number; ingredient_name: string; unit: string; quantity: number; unit_cost: number;
  arrived: string; refused: string; reason: RejectionReason | ""; price: string; expiry_date: string; area: string;
};
type DeliveryCheck = { id: number; item: string; temp_value: number | null; accepted: boolean; corrective_action: string | null; created_at: string; staff_name: string | null };

function ReceivePoModal({ poId, onClose, onSaved }: { poId: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState<ReceiveLine[]>([]);
  const [orderNumber, setOrderNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [checks, setChecks] = useState<DeliveryCheck[] | null>(null);
  const [areas, setAreas] = useState<{ id: number; name: string }[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [saving, setSaving] = useState(false);
  const accepted = (i: ReceiveLine) => Math.max(0, (num(i.arrived) || 0) - (num(i.refused) || 0));
  const total = Math.round(items.reduce((sum, i) => sum + accepted(i) * (num(i.price) || 0), 0) * 100) / 100;

  useEffect(() => {
    fetch("/api/storage-areas").then((r) => r.json()).then((d) => setAreas(d.areas || [])).catch(() => {});
    fetch(`/api/purchase-orders/${poId}`).then((r) => r.json()).then((d) => {
      const lastArea: Record<number, number> = d.lastArea || {};
      setOrderNumber(d.purchaseOrder.order_number);
      setSupplier(d.purchaseOrder.supplier_name ?? "");
      setChecks(d.deliveryChecks || []);
      setItems((d.items || []).map((i: { id: number; ingredient_id: number; ingredient_name: string; unit: string; quantity: number; unit_cost: number }) => ({
        ...i, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost),
        arrived: String(Number(i.quantity)), refused: "", reason: "", price: String(Number(i.unit_cost)), expiry_date: "",
        // Where this item went last time (it's only used once a use-by is entered).
        area: lastArea[i.ingredient_id] ? String(lastArea[i.ingredient_id]) : "",
      })));
    });
  }, [poId]);
  const set = (k: number, patch: Partial<ReceiveLine>) => setItems((prev) => prev.map((it, idx) => (idx === k ? { ...it, ...patch } : it)));

  async function confirm() {
    if (receipts.length === 0) return toast({ variant: "destructive", title: "Photo needed", description: "Take a photo of the supplier's invoice first." });
    if (items.some((i) => !(num(i.arrived) >= 0))) return toast({ variant: "destructive", title: "Enter what arrived on every line (0 if nothing)" });
    if (items.some((i) => (num(i.refused) || 0) > (num(i.arrived) || 0))) return toast({ variant: "destructive", title: "Refused can't be more than arrived" });
    if (items.some((i) => (num(i.refused) || 0) > 0 && !i.reason)) return toast({ variant: "destructive", title: "Pick a reason for everything refused" });
    if (items.some((i) => accepted(i) > 0 && !(num(i.price) > 0))) return toast({ variant: "destructive", title: "Enter the invoice price on every line you're keeping" });
    if (saving) return;
    setSaving(true);
    const res = await fetch(`/api/purchase-orders/${poId}/receive`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((i) => ({
          item_id: i.id, received_quantity: num(i.arrived), expiry_date: i.expiry_date || undefined,
          unit_cost: num(i.price) > 0 ? num(i.price) : undefined,
          rejected_quantity: (num(i.refused) || 0) > 0 ? num(i.refused) : undefined,
          rejection_reason: (num(i.refused) || 0) > 0 ? i.reason : undefined,
          storage_area_id: i.expiry_date && i.area ? Number(i.area) : undefined,
        })),
        receipt_ids: receipts.map((r) => r.id),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res) return toast({ variant: "destructive", title: "Couldn't receive order", description: "No connection. Check the Wi-Fi and try again." });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast({ variant: "destructive", title: "Couldn't receive order", description: data.error });
    toast({
      variant: "success",
      title: data.purchaseOrder?.short_delivery ? "Received — short delivery noted" : "Delivery received",
      description: `Cost counted in Finance: £${Number(data.purchaseOrder?.total_cost ?? 0).toFixed(2)}`,
    });
    onSaved(); onClose();
  }

  return (
    <div className={overlay}>
      <div className={`${panel} max-w-3xl`}>
        <h2 className="text-foreground font-bold text-lg">Receive {orderNumber}{supplier ? ` · ${supplier}` : ""}</h2>
        <p className="mt-1 text-muted-foreground text-xs">Enter what arrived, anything you refused at the door (and why), and the price on the invoice. Only what you keep goes into stock and Finance. Anything short or refused is noted and the order closes. Enter the use-by date for dated products — they&apos;re tracked as batches.</p>

        {/* Temperatures live in Food Safety — shown here, not asked again. */}
        <div className="mt-3 rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm">
          <p className="text-foreground font-semibold">Food Safety delivery check</p>
          {checks === null ? <p className="text-muted-foreground text-xs">Loading…</p>
            : checks.length === 0 ? <p className="text-amber-700 text-xs">None logged today for {supplier || "this supplier"}. Log the temperatures in the Food Safety app (Delivery checks).</p>
            : <ul className="mt-0.5 space-y-0.5">{checks.map((c) => (
                <li key={c.id} className={`text-xs ${c.accepted ? "text-foreground" : "text-red-700"}`}>
                  {c.accepted ? "✓" : "✗"} {c.item}{c.temp_value != null ? ` · ${Number(c.temp_value)}°C` : ""} · {c.staff_name ?? "—"} · {new Date(c.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}
                  {!c.accepted && c.corrective_action ? ` — ${c.corrective_action}` : ""}
                </li>
              ))}</ul>}
        </div>

        <div className="mt-4 space-y-4">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_72px_72px_150px_86px_130px] gap-2 text-xs text-muted-foreground">
            <span>Item (ordered)</span><span>Arrived</span><span>Refused</span><span>Why refused</span><span>Invoice £</span><span>Use by</span>
          </div>
          {items.map((item, i) => {
            const changed = num(item.price) > 0 && Math.abs(num(item.price) - item.unit_cost) > 0.00005;
            const refused = num(item.refused) || 0;
            const notDelivered = Math.max(0, item.quantity - (num(item.arrived) || 0));
            return (
              <div key={item.id} className="space-y-1">
                <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_72px_72px_150px_86px_130px] gap-2 items-center">
                  <span className="col-span-2 md:col-span-1 text-foreground text-sm">{item.ingredient_name} <span className="text-muted-foreground">({item.quantity} {item.unit} @ {money(item.unit_cost)})</span></span>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={item.arrived} onChange={(e) => set(i, { arrived: e.target.value })} className={input} aria-label={`${item.ingredient_name} arrived`} placeholder="Arrived" />
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={item.refused} onChange={(e) => set(i, { refused: e.target.value })} className={`${input} ${refused > 0 ? "border-red-400" : ""}`} aria-label={`${item.ingredient_name} refused`} placeholder="0" />
                  <select value={item.reason} disabled={refused <= 0} onChange={(e) => set(i, { reason: e.target.value as RejectionReason | "" })} className={`${input} col-span-2 md:col-span-1 disabled:opacity-40 ${refused > 0 && !item.reason ? "border-red-400" : ""}`} aria-label={`${item.ingredient_name} why refused`}>
                    <option value="">{refused > 0 ? "Why refused?" : "—"}</option>
                    {REJECTION_REASONS.map((r) => <option key={r} value={r}>{REJECTION_LABEL[r]}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={item.price} onChange={(e) => set(i, { price: e.target.value })} className={`${input} ${changed ? "border-amber-500 bg-amber-50 text-amber-900" : ""}`} aria-label={`${item.ingredient_name} invoice price`} />
                  <input type="date" value={item.expiry_date} onChange={(e) => set(i, { expiry_date: e.target.value })} className={input} aria-label={`${item.ingredient_name} use by`} />
                </div>
                {item.expiry_date && areas.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Kept in</span>
                    <select value={item.area} onChange={(e) => set(i, { area: e.target.value })} className={`${input} py-1`} aria-label={`Where ${item.ingredient_name} is kept`}>
                      <option value="">— choose (optional)</option>
                      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
                <p className="text-xs">
                  <span className="text-foreground">Into stock: <b>{Math.round(accepted(item) * 1000) / 1000} {item.unit}</b></span>
                  {notDelivered > 0 && <span className="text-amber-700"> · {Math.round(notDelivered * 1000) / 1000} {item.unit} not delivered</span>}
                  {refused > 0 && <span className="text-red-700"> · {refused} {item.unit} refused</span>}
                  {changed && <span className="text-amber-700"> · price {money(item.unit_cost)} → {money(num(item.price))}</span>}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-right text-foreground text-sm font-semibold">Delivery total (kept): {money(total)}</p>
        <div className="mt-3">
          <ReceiptPhotos entity="purchase_order" label="Supplier invoice photo" value={receipts} onChange={setReceipts} />
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 h-10 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Cancel</button>
          <button onClick={confirm} disabled={receipts.length === 0 || saving} className="flex-1 h-10 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold rounded-xl">{saving ? "Saving…" : "Mark Received"}</button>
        </div>
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────
function HistoryModal({ poId, onClose }: { poId: number; onClose: () => void }) {
  const [data, setData] = useState<{ number: string; events: { id: number; action: string; comment: string | null; created_at: string; staff_name: string | null }[]; items: { id: number; ingredient_name: string; unit: string; quantity: number; unit_cost: number }[] } | null>(null);
  useEffect(() => {
    fetch(`/api/purchase-orders/${poId}`).then((r) => r.json()).then((d) => setData({ number: d.purchaseOrder?.order_number ?? "", events: d.events || [], items: d.items || [] })).catch(() => setData({ number: "", events: [], items: [] }));
  }, [poId]);
  return (
    <div className={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${panel} max-w-md`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-foreground font-bold text-lg">{data?.number || "Order"}</h2>
          <button onClick={onClose} className={btnPlain}>Close</button>
        </div>
        {!data ? <p className="mt-4 text-muted-foreground text-sm">Loading…</p> : <>
          <ul className="mt-3 space-y-0.5 text-sm text-foreground">
            {data.items.map((i) => <li key={i.id}>{i.ingredient_name} · {Number(i.quantity)} {i.unit} @ {money(i.unit_cost)}</li>)}
          </ul>
          <ol className="mt-4 border-l-2 border-border pl-3 space-y-2 text-sm">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className="text-foreground font-semibold">{EVENT_LABEL[e.action] ?? e.action}</span>
                <span className="text-muted-foreground"> · {e.staff_name ?? "—"} · {new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</span>
                {e.comment && <p className="text-muted-foreground text-xs">“{e.comment}”</p>}
              </li>
            ))}
            {data.events.length === 0 && <li className="text-muted-foreground">No history yet.</li>}
          </ol>
          <p className="mt-3 text-muted-foreground text-xs">Every step is kept and can&apos;t be edited.</p>
        </>}
      </div>
    </div>
  );
}

// ── A short question (reason / amount) ──────────────────────────────────────
function AskModal({ title, hint, required, initial, numeric, onOk, onClose }: {
  title: string; hint: string; required: boolean; initial?: string; numeric?: boolean; onOk: (v: string) => Promise<void>; onClose: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const ok = required ? value.trim() !== "" : true;
  async function submit() {
    if (!ok || saving) return;
    setSaving(true);
    await onOk(value.trim());
    setSaving(false);
    onClose();
  }
  return (
    <div className={overlay}>
      <div className={`${panel} max-w-sm`}>
        <h2 className="text-foreground font-bold text-lg">{title}</h2>
        <input
          autoFocus type={numeric ? "number" : "text"} inputMode={numeric ? "decimal" : undefined} placeholder={hint} value={value}
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          className={`${input} mt-3 w-full`} maxLength={numeric ? undefined : 500}
        />
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 h-10 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Back</button>
          <button onClick={submit} disabled={!ok || saving} className="flex-1 h-10 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-xl">{saving ? "Saving…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}
