"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";

type LocationOption = { id: number; name: string };
type Employee = { id: number; name: string; employee_number: string | null; role: string; location_ids?: number[] };

export default function StaffLocationAssignments({ staffId }: { staffId: number }) {
  const { toast } = useToast();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [empRes, locRes] = await Promise.all([fetch(`/api/employees/${staffId}`), fetch("/api/locations")]);
        const empData = await empRes.json();
        const locData = await locRes.json();
        if (!empRes.ok) throw new Error(empData.error || "Failed to load staff member");
        if (!locRes.ok) throw new Error(locData.error || "Failed to load locations");
        if (cancelled) return;
        setEmployee(empData.employee);
        setLocations(locData.locations ?? []);
        setChecked(new Set(empData.employee.location_ids ?? []));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [staffId]);

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/staff/${staffId}/locations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_ids: [...checked].sort((a, b) => a - b) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setChecked(new Set(data.staff.location_ids));
      setEmployee((prev) => (prev ? { ...prev, location_ids: data.staff.location_ids } : prev));
      toast({ title: "Locations saved" });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (error || !employee) return <p className="text-red-600 text-sm">{error ?? "Staff member not found"}</p>;

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link href="/staff/hr" className="text-sm text-muted-foreground hover:text-foreground">← Back to staff</Link>
        <h1 className="text-foreground font-bold text-xl mt-2">{employee.name}</h1>
        <p className="text-muted-foreground text-sm capitalize">
          {employee.employee_number} · {employee.role.replace("_", " ")}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div>
          <h2 className="text-foreground font-semibold">Locations</h2>
          <p className="text-muted-foreground text-xs">
            Tick every location this person works at. Leave all unticked and they can work at any location.
          </p>
        </div>
        {locations.length === 0 && <p className="text-muted-foreground text-sm">No active locations set up yet.</p>}
        {locations.map((l) => (
          <label key={l.id} className="flex items-center gap-3 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} className="h-4 w-4" />
            {l.name}
          </label>
        ))}
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-sm font-bold rounded-lg">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
