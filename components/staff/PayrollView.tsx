"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { PayrollPeriod, PayrollEntry } from "@/lib/types";
import { hoursMinutes } from "@/lib/utils";

const statusBadge: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  partially_paid: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
};

function PaymentModal({
  entry, onClose, onSaved,
}: { entry: PayrollEntry & { staff_name: string }; onClose: () => void; onSaved: () => void }) {
  const remaining = Math.round((entry.gross_pay - entry.paid_amount) * 100) / 100;
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState("bank_transfer");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function submit(full: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/payroll/entries/${entry.id}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full ? { full: true, method } : { amount: Number(amount), method }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ variant: "success", title: "Payment recorded", description: `${entry.staff_name}: £${(full ? remaining : Number(amount)).toFixed(2)}.` });
      onSaved();
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't record payment", description: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-5">
        <h2 className="text-foreground font-bold text-lg">Pay {entry.staff_name}</h2>
        <p className="text-muted-foreground text-sm mt-1">Remaining: £{remaining.toFixed(2)}</p>
        <div className="mt-4 space-y-3">
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm">
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 bg-elevated hover:bg-elevated-hover text-foreground font-semibold rounded-xl">Cancel</button>
          <button onClick={() => submit(false)} disabled={saving} className="flex-1 h-10 bg-elevated hover:bg-elevated-hover disabled:opacity-50 text-foreground font-bold rounded-xl text-sm">Pay Amount</button>
          <button onClick={() => submit(true)} disabled={saving} className="flex-1 h-10 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm">Pay in Full</button>
        </div>
      </div>
    </div>
  );
}

export function PayrollBody() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [activePeriod, setActivePeriod] = useState<PayrollPeriod | null>(null);
  const [entries, setEntries] = useState<(PayrollEntry & { staff_name: string })[]>([]);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [payingEntry, setPayingEntry] = useState<(PayrollEntry & { staff_name: string }) | null>(null);
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const loadPeriods = useCallback(async () => {
    const res = await fetch("/api/payroll/periods");
    const data = await res.json();
    setPeriods(data.periods || []);
  }, []);
  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const loadEntries = useCallback(async (periodId: number) => {
    const res = await fetch(`/api/payroll/entries?period_id=${periodId}`);
    const data = await res.json();
    setEntries(data.entries || []);
  }, []);

  function selectPeriod(p: PayrollPeriod) {
    setActivePeriod(p);
    loadEntries(p.id);
  }

  async function createPeriod() {
    if (!newStart || !newEnd) return toast({ variant: "destructive", title: "Pick a start and end date" });
    const res = await fetch("/api/payroll/periods", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period_start: newStart, period_end: newEnd }),
    });
    const data = await res.json();
    if (!res.ok) return toast({ variant: "destructive", title: "Couldn't create period", description: data.error });
    toast({ variant: "success", title: "Pay period created", description: `${newStart} → ${newEnd}` });
    setNewStart(""); setNewEnd("");
    await loadPeriods();
    selectPeriod(data.period);
  }

  async function runPayroll() {
    if (!activePeriod) return;
    setRunning(true);
    const res = await fetch(`/api/payroll/periods/${activePeriod.id}/run`, { method: "POST" });
    await loadEntries(activePeriod.id);
    setRunning(false);
    if (!res.ok) {
      const data = await res.json();
      return toast({ variant: "destructive", title: "Couldn't run payroll", description: data.error });
    }
    toast({ variant: "success", title: "Payroll run from attendance" });
  }

  async function updateEntry(id: number, field: string, value: number) {
    const res = await fetch(`/api/payroll/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    if (!res.ok) {
      const data = await res.json();
      toast({ variant: "destructive", title: "Couldn't save change", description: data.error });
    }
    if (activePeriod) loadEntries(activePeriod.id);
  }

  const totals = entries.reduce((acc, e) => ({ gross: acc.gross + e.gross_pay, paid: acc.paid + e.paid_amount }), { gross: 0, paid: 0 });

  return (
    <div>
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="min-w-0">
            <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-4">
              <h2 className="text-muted-foreground text-xs font-bold uppercase tracking-widest">New Pay Period</h2>
              <input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="mt-2 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
              <input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className="mt-2 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
              <button onClick={createPeriod} className="mt-2 w-full py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg">Create Period</button>
            </div>

            <div className="mt-4 space-y-2">
              {periods.map((p) => (
                <button key={p.id} onClick={() => selectPeriod(p)}
                  className={`w-full text-left rounded-lg border px-3 py-2 text-sm ${activePeriod?.id === p.id ? "border-red-300 bg-red-50" : "border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)]"}`}>
                  <div className="text-foreground font-medium">{p.period_start} → {p.period_end}</div>
                  <div className="text-muted-foreground text-xs capitalize">{p.status}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            {!activePeriod ? (
              <div className="text-muted-foreground text-center py-20">Select or create a pay period.</div>
            ) : (
              <>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-foreground font-bold">{activePeriod.period_start} → {activePeriod.period_end}</h2>
                  <button onClick={runPayroll} disabled={running} className="px-4 py-2 bg-surface-hover hover:bg-elevated disabled:opacity-50 text-foreground text-sm font-semibold rounded-lg border border-border">
                    {running ? "Running…" : "▶ Run Payroll from Attendance"}
                  </button>
                </div>
                <p className="text-muted-foreground text-xs mt-1">Gross: £{totals.gross.toFixed(2)} · Paid: £{totals.paid.toFixed(2)}</p>

                <div className="mt-4 space-y-3">
                  {entries.map((e) => (
                    <div key={e.id} className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-foreground font-semibold">{e.staff_name}</p>
                          <p className="text-muted-foreground text-xs">{hoursMinutes(e.hours_worked)} × £{Number(e.pay_rate).toFixed(2)} = £{Number(e.base_pay).toFixed(2)} base</p>
                        </div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge[e.status]}`}>{e.status.replace("_", " ")}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                        {(["bonuses", "tips", "deductions", "holiday_pay"] as const).map((field) => (
                          <div key={field}>
                            <label className="block text-muted-foreground capitalize mb-1">{field.replace("_", " ")}</label>
                            <input type="number" step="0.01" defaultValue={e[field]} disabled={e.status === "paid"}
                              onBlur={(ev) => updateEntry(e.id, field, Number(ev.target.value))}
                              className="w-full bg-surface-hover border border-border rounded-lg px-2 py-1 text-foreground disabled:opacity-50" />
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-foreground font-bold">Gross: £{Number(e.gross_pay).toFixed(2)} <span className="text-muted-foreground font-normal text-sm">· Paid £{Number(e.paid_amount).toFixed(2)}</span></p>
                        {e.status !== "paid" && (
                          <button onClick={() => setPayingEntry(e)} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg">Record Payment</button>
                        )}
                      </div>
                    </div>
                  ))}
                  {entries.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No entries yet — run payroll to generate them from attendance.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {payingEntry && (
        <PaymentModal entry={payingEntry} onClose={() => setPayingEntry(null)} onSaved={() => activePeriod && loadEntries(activePeriod.id)} />
      )}
    </div>
  );
}

// Standalone route (/staff/payroll) — kept for old bookmarks/links; the normal
// way in is now the Payroll tab inside HR, which renders PayrollBody directly.
export default function PayrollView() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between flex-wrap gap-3">
          <div>
            <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">Payroll <span className="text-muted-foreground text-sm font-normal">· HR Management</span></h1>
            <p className="text-muted-foreground text-sm">Pay periods, hours worked and payment history.</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-6">
        <PayrollBody />
      </div>
    </>
  );
}
