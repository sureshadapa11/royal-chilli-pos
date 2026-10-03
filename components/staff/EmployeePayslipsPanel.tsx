"use client";

import { roleLabel } from "@/lib/roles";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Staff } from "@/lib/types";
import { firstOfMonthStr, londonDateStr } from "@/lib/london-date";

type Payslip = {
  id: number; staff_id: number; name: string; period_start: string; period_end: string;
  hours_worked: number; pay_rate: number; total_amount: number; status: "unpaid" | "paid"; paid_at: string | null; created_at: string;
};

function fmtMoney(n: number) { return `£${Number(n).toFixed(2)}`; }
function fmtDate(d: string) { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
function today() { return londonDateStr(); }
function firstOfMonth() { return firstOfMonthStr(); }

// ── Employee picker — search + role/active filters, same shape as HR's directory ──
function EmployeePicker({ selected, onSelect }: { selected: Staff | null; onSelect: (s: Staff) => void }) {
  const [employees, setEmployees] = useState<Staff[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("1");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ active: activeFilter });
    if (search) params.set("search", search);
    if (roleFilter) params.set("role", roleFilter);
    const res = await fetch(`/api/employees?${params}`);
    const data = await res.json();
    setEmployees(data.employees || []);
  }, [search, roleFilter, activeFilter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] overflow-hidden">
      <div className="p-2 border-b border-border space-y-2">
        <input placeholder="Search name, ID, email…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        <div className="flex gap-2">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            className="flex-1 min-w-0 bg-surface-hover border border-border rounded-lg px-2 py-2 text-foreground text-xs">
            <option value="">All roles</option>
            {["manager", "hr", "employee", "kitchen"].map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}
            className="flex-1 min-w-0 bg-surface-hover border border-border rounded-lg px-2 py-2 text-foreground text-xs">
            <option value="1">Active</option>
            <option value="0">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>
      <div className="lg:max-h-[420px] lg:overflow-y-auto">
        {employees.map((e) => (
          <button key={e.id} onClick={() => onSelect(e)}
            className={`w-full text-left px-3 py-2.5 border-b border-border last:border-0 transition-colors ${selected?.id === e.id ? "bg-red-500/10" : "hover:bg-surface-hover"}`}>
            <p className="text-foreground font-medium text-sm truncate">{e.name}</p>
            <p className="text-muted-foreground text-xs capitalize">{e.employee_number} · {roleLabel(e.role)} · £{Number(e.pay_rate).toFixed(2)}/hr</p>
          </button>
        ))}
        {employees.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No employees found.</p>}
      </div>
    </div>
  );
}

// ── Create Payslip ────────────────────────────────────────────────────────
function CreatePayslip({ staff, onCreated }: { staff: Staff; onCreated: () => void }) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [created, setCreated] = useState<Payslip | null>(null);

  async function create() {
    setSaving(true);
    setCreated(null);
    try {
      const res = await fetch("/api/employee-payslips", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: staff.id, period_start: from, period_end: to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create payslip");
      setCreated(data.payslip);
      onCreated();
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't create payslip", description: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-4">
      <h3 className="text-foreground font-bold text-sm">Create Payslip for {staff.name}</h3>
      <p className="text-muted-foreground text-xs mt-1">
        Hours are pulled live from clocked-in-and-out shifts in this range, at their current rate of £{Number(staff.pay_rate).toFixed(2)}/hr.
        A shift still open (no clock-out yet) doesn&apos;t count until it&apos;s closed.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div>
          <label className="block text-muted-foreground text-xs mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        </div>
        <div>
          <label className="block text-muted-foreground text-xs mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm" />
        </div>
        <button onClick={create} disabled={saving} className="mt-5 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
          {saving ? "Calculating…" : "Create Payslip"}
        </button>
      </div>
      {created && (
        <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          <p className="text-emerald-700 font-semibold">✓ {created.name} created</p>
          <p className="text-muted-foreground mt-1">{created.hours_worked}h × £{Number(created.pay_rate).toFixed(2)} = <span className="text-foreground font-semibold">{fmtMoney(created.total_amount)}</span></p>
        </div>
      )}
    </div>
  );
}

// ── Payslip History ─────────────────────────────────────────────────────────
function PayslipHistory({ staff }: { staff: Staff }) {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/employee-payslips?staff_id=${staff.id}`);
    const data = await res.json();
    setPayslips(data.payslips || []);
    setLoading(false);
  }, [staff.id]);
  useEffect(() => { load(); }, [load]);

  async function toggleStatus(p: Payslip) {
    setBusyId(p.id);
    const nextStatus = p.status === "paid" ? "unpaid" : "paid";
    try {
      const res = await fetch(`/api/employee-payslips/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
      const data = await res.json();
      if (res.ok) setPayslips((prev) => prev.map((x) => (x.id === p.id ? data.payslip : x)));
    } finally {
      setBusyId(null);
    }
  }

  const filtered = payslips.filter((p) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return p.name.toLowerCase().includes(q) || fmtDate(p.period_start).toLowerCase().includes(q) || fmtDate(p.period_end).toLowerCase().includes(q);
  });

  return (
    <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="text-foreground font-bold text-sm">{staff.name}&apos;s Payslips</h3>
        <input
          placeholder="Search by payslip name or month…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="mt-2 w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
        />
      </div>
      {loading ? (
        <div className="text-muted-foreground text-center py-10">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-hover text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Pay Period</th>
                <th className="text-right px-4 py-2.5">Hours</th>
                <th className="text-right px-4 py-2.5">Per Hour</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-center px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => (
                <tr key={p.id} className="bg-background">
                  <td className="px-4 py-3 text-foreground font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{p.hours_worked}</td>
                  <td className="px-4 py-3 text-right text-foreground">£{Number(p.pay_rate).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-foreground font-semibold">{fmtMoney(p.total_amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleStatus(p)}
                      disabled={busyId === p.id}
                      title={p.status === "paid" && p.paid_at ? `Paid ${new Date(p.paid_at).toLocaleString("en-GB")}` : "Click to mark paid"}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${p.status === "paid" ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                    >
                      {p.status === "paid" ? "✓ Paid" : "Unpaid"}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">{payslips.length === 0 ? "No payslips yet for this employee." : "No payslips match your search."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────
export default function EmployeePayslipsPanel() {
  const [selected, setSelected] = useState<Staff | null>(null);
  const [view, setView] = useState<"create" | "history">("history");
  const [refreshKey, setRefreshKey] = useState(0);

  function select(s: Staff) {
    setSelected(s);
    setView("history");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <div className="min-w-0">
        <EmployeePicker selected={selected} onSelect={select} />
      </div>

      <div className="min-w-0">
        {!selected ? (
          <div className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] p-10 text-center text-muted-foreground">
            Select an employee to create a payslip or view their history.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <h2 className="text-foreground font-bold text-lg">{selected.name}</h2>
              <div className="flex gap-1 bg-surface-hover p-1 rounded-xl">
                <button onClick={() => setView("create")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${view === "create" ? "bg-red-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>+ Create Payslip</button>
                <button onClick={() => setView("history")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${view === "history" ? "bg-red-500 text-white" : "text-muted-foreground hover:text-foreground"}`}>View History</button>
              </div>
            </div>
            {view === "create" ? (
              <CreatePayslip staff={selected} onCreated={() => { setRefreshKey((k) => k + 1); setView("history"); }} />
            ) : (
              <PayslipHistory key={refreshKey} staff={selected} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
