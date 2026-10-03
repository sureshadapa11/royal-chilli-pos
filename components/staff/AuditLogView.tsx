"use client";

import { ROLE_LABEL } from "@/lib/roles";
import { useEffect, useMemo, useState } from "react";

type LogEntry = {
  id: number;
  staff_name: string;
  staff_role: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  changes: Record<string, unknown> | null;
  created_at: string;
};


export default function AuditLogView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  useEffect(() => {
    const load = () =>
      fetch("/api/audit-logs")
        .then((r) => r.json())
        .then((d) => setLogs(d.logs || []))
        .finally(() => setLoading(false));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const roles = useMemo(() => [...new Set(logs.map((l) => l.staff_role).filter((r): r is string => !!r))], [logs]);

  const filtered = logs.filter((l) => {
    if (roleFilter && l.staff_role !== roleFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      l.staff_name.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      l.entity_type.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between flex-wrap gap-3">
          <div>
            <h1 style={{ fontFamily: "var(--font-space-grotesk)" }} className="text-foreground text-[22px] font-semibold tracking-[-0.02em]">Audit Log</h1>
            <p className="text-muted-foreground text-sm">A read-only history of who changed what, across every module.</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl mt-3 flex gap-2 flex-wrap">
          <input
            placeholder="Search by name, action or purpose…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-foreground text-sm"
          >
            <option value="">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
          </select>
        </div>
      </div>

      <div className="px-4 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="mt-5 space-y-1.5">
          {loading ? (
            <div className="text-muted-foreground text-center py-16">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground text-center py-16">{logs.length === 0 ? "No activity recorded yet." : "No log entries match your search."}</div>
          ) : (
            filtered.map((l) => (
              <div key={l.id} className="rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)] px-4 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <span className="text-foreground font-semibold">{l.staff_name}</span>
                  {l.staff_role && <span className="text-muted-foreground"> ({ROLE_LABEL[l.staff_role] || l.staff_role})</span>}
                  <span className="text-muted-foreground"> {l.action} </span>
                  <span className="text-red-600">{l.entity_type}</span>
                  {l.entity_id && <span className="text-muted-foreground"> #{l.entity_id}</span>}
                  {l.changes && <span className="text-muted-foreground text-xs block mt-0.5 break-words">{JSON.stringify(l.changes)}</span>}
                </div>
                <span className="flex-shrink-0 text-muted-foreground text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString("en-GB")}</span>
              </div>
            ))
          )}
        </div>
      </div>
      </div>
    </>
  );
}
