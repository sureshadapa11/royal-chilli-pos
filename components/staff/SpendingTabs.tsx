"use client";

import { useCallback, useEffect, useState } from "react";
import { tradingDayStr } from "@/lib/london-date";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import ReceiptPhotos, { ReceiptLinks, type Receipt } from "@/components/staff/ReceiptPhotos";

// Inventory → Expenses and Inventory → Supplier Payments: the money going
// out. (Moved from Finance, which is now read-only analysis.) Only staff with
// Finance access can record these — the APIs check canManageFinance. Every
// entry needs a photo of its receipt / invoice / payment confirmation.

type PhotoMap = Record<string, { id: number; amount_mismatch: boolean }[]>;
async function loadPhotos(entity: string, ids: number[]): Promise<PhotoMap> {
  if (ids.length === 0) return {};
  const res = await fetch(`/api/receipts?entity=${entity}&ids=${ids.slice(0, 500).join(",")}`);
  return res.ok ? (await res.json()).receipts || {} : {};
}

function fmtMoney(n: number) { return `£${Number(n).toFixed(2)}`; }
function today() { return tradingDayStr(); }

export function ExpensesTab() {
  const [expenses, setExpenses] = useState<{ id: number; category: string; description: string; amount: number; expense_date: string; vat_applicable: number }[]>([]);
  const [form, setForm] = useState({ category: "other", description: "", amount: "", vat_applicable: true, expense_date: today() });
  const [error, setError] = useState("");
  const [dupe, setDupe] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [mismatch, setMismatch] = useState(false);
  const [photos, setPhotos] = useState<PhotoMap>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/expenses");
    const list = (await res.json()).expenses || [];
    setExpenses(list);
    setPhotos(await loadPhotos("expense", list.map((e: { id: number }) => e.id)));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setError("");
    if (!form.description.trim()) return setError("Add a description.");
    if (!(Number(form.amount) > 0)) return setError("Amount must be more than £0.");
    if (receipts.length === 0) return setError("Add a photo of the receipt or invoice.");
    const res = await fetch("/api/expenses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form, amount: Number(form.amount), vat_applicable: form.vat_applicable ? 1 : 0, allow_duplicate: dupe,
        receipt_ids: receipts.map((r) => r.id), confirm_amount: mismatch,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Couldn't save"); setDupe(!!data.duplicate); setMismatch(!!data.mismatch); return; }
    setDupe(false); setMismatch(false); setReceipts([]);
    setForm({ category: "other", description: "", amount: "", vat_applicable: true, expense_date: today() });
    load();
  }

  // Fill in what the AI read from the receipt, without overwriting anything typed.
  function fillFrom(r: Receipt) {
    setForm((f) => ({
      ...f,
      amount: f.amount || (r.ai_total !== null ? r.ai_total.toFixed(2) : ""),
      description: f.description || r.ai_supplier || "",
      expense_date: r.ai_date && r.ai_date <= today() ? r.ai_date : f.expense_date,
    }));
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
          {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm col-span-2" />
        <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setMismatch(false); }} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <button onClick={save} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">{mismatch ? "Save anyway" : dupe ? "Add anyway" : "+ Add"}</button>
      </div>
      <div className="mt-2">
        <ReceiptPhotos entity="expense" value={receipts} onChange={(next) => { setReceipts(next); setMismatch(false); }} onRead={fillFrom} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          Date <input type="date" value={form.expense_date} onChange={(e) => { setForm({ ...form, expense_date: e.target.value }); setDupe(false); }} className="bg-surface-hover border border-border rounded-lg px-2 py-1 text-foreground text-sm" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.vat_applicable} onChange={(e) => setForm({ ...form, vat_applicable: e.target.checked })} /> VAT applicable (amount includes VAT)
        </label>
      </div>
      {error && <p className="mt-2 text-red-600 text-xs">{error}{dupe && " — press Add anyway if it really is a second one."}{mismatch && " Check the amount, or press Save anyway if it's right."}</p>}
      <p className="mt-2 text-muted-foreground text-xs">
        Not for food/stock invoices — those are counted from Inventory → Purchase Orders when received. Not for staff pay (from attendance), card fees or delivery-platform commission (all worked out automatically).
      </p>
      <div className="mt-4 space-y-1.5">
        {expenses.map((e) => (
          <div key={e.id} className="flex justify-between text-sm rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-2">
            <span className="text-foreground"><span className="capitalize">{e.category.replace("_", " ")}</span> · {e.description} <span className="text-muted-foreground">({e.expense_date})</span></span>
            <span className="flex items-center gap-3"><ReceiptLinks photos={photos[e.id]} /><span className="text-foreground">{fmtMoney(e.amount)}</span></span>
          </div>
        ))}
        {expenses.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No expenses recorded yet.</p>}
      </div>
    </div>
  );
}

export function SupplierPaymentsTab() {
  const [payments, setPayments] = useState<{ id: number; supplier_name: string; amount: number; method: string | null; paid_at: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [form, setForm] = useState({ supplier_id: "", amount: "", method: "bank_transfer" });
  const [error, setError] = useState("");
  const [dupe, setDupe] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [mismatch, setMismatch] = useState(false);
  const [photos, setPhotos] = useState<PhotoMap>({});

  const loadSuppliers = useCallback(async () => {
    const res = await fetch("/api/suppliers");
    setSuppliers((await res.json()).suppliers || []);
  }, []);
  const load = useCallback(async () => {
    const res = await fetch("/api/supplier-payments");
    const list = (await res.json()).payments || [];
    setPayments(list);
    setPhotos(await loadPhotos("supplier_payment", list.map((p: { id: number }) => p.id)));
  }, []);
  useEffect(() => { load(); loadSuppliers(); }, [load, loadSuppliers]);

  async function save() {
    setError("");
    if (!form.supplier_id) return setError("Pick a supplier.");
    if (!(Number(form.amount) > 0)) return setError("Amount must be more than £0.");
    if (receipts.length === 0) return setError("Add a photo of the invoice or the payment confirmation.");
    const res = await fetch("/api/supplier-payments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_id: Number(form.supplier_id), amount: Number(form.amount), method: form.method, allow_duplicate: dupe,
        receipt_ids: receipts.map((r) => r.id), confirm_amount: mismatch,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Couldn't record payment"); setDupe(!!data.duplicate); setMismatch(!!data.mismatch); return; }
    setDupe(false); setMismatch(false); setReceipts([]);
    setForm({ supplier_id: "", amount: "", method: "bank_transfer" });
    load();
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select value={form.supplier_id} onChange={(e) => { setForm({ ...form, supplier_id: e.target.value }); setDupe(false); }} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm col-span-2">
          <option value="">Select supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setDupe(false); setMismatch(false); }} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <button onClick={save} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">{mismatch || dupe ? "Record anyway" : "+ Record"}</button>
      </div>
      <div className="mt-2">
        <ReceiptPhotos
          entity="supplier_payment" label="Invoice / payment confirmation photo" value={receipts}
          onChange={(next) => { setReceipts(next); setMismatch(false); }}
          onRead={(r) => setForm((f) => ({ ...f, amount: f.amount || (r.ai_total !== null ? r.ai_total.toFixed(2) : "") }))}
        />
      </div>
      {error && <p className="mt-2 text-red-600 text-xs">{error}{dupe && " — press Record anyway if it really is a second payment."}{mismatch && " Check the amount, or press Record anyway if it's right."}</p>}
      <p className="mt-2 text-muted-foreground text-xs">
        A record of money paid to suppliers — it isn&apos;t a cost in Profit &amp; Loss (the cost is counted once, when the purchase order is received). Suppliers are added in the Suppliers tab.
      </p>
      <div className="mt-4 space-y-1.5">
        {payments.map((p) => (
          <div key={p.id} className="flex justify-between text-sm rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-2">
            <span className="text-foreground">{p.supplier_name} {p.method && `· ${p.method.replace("_", " ")}`} <span className="text-muted-foreground">({new Date(p.paid_at).toLocaleDateString("en-GB")})</span></span>
            <span className="flex items-center gap-3"><ReceiptLinks photos={photos[p.id]} /><span className="text-foreground">{fmtMoney(p.amount)}</span></span>
          </div>
        ))}
        {payments.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No supplier payments recorded yet.</p>}
      </div>
    </div>
  );
}
