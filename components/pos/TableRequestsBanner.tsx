"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playBuzzer } from "@/lib/buzzer";

interface TableRequest {
  id: number;
  type: "waiter" | "bill" | "allergy";
  table_number: string | null;
  created_at: string;
}

// Polls for pending "call waiter" / "request bill" alerts and shows them as
// a banner, with a short chime the first time a given request id appears —
// not on every poll, so an unresolved request sitting on screen doesn't
// buzz again every 8 seconds. Shared between the main POS screen and
// Reservations so both stay in sync off the same source.
export default function TableRequestsBanner() {
  const [requests, setRequests] = useState<TableRequest[]>([]);
  const seenIds = useRef<Set<number>>(new Set());

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/table-requests", { cache: "no-store" });
      const data = await res.json();
      const next: TableRequest[] = data.requests || [];

      const hasNew = next.some((r) => !seenIds.current.has(r.id));
      if (hasNew) playBuzzer();
      seenIds.current = new Set(next.map((r) => r.id));

      setRequests(next);
    } catch {
      // next poll retries
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    const t = setInterval(fetchRequests, 8000);
    return () => clearInterval(t);
  }, [fetchRequests]);

  const resolve = async (id: number) => {
    await fetch("/api/table-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    fetchRequests();
  };

  if (requests.length === 0) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 space-y-1.5 flex-shrink-0">
      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 max-w-2xl mx-auto">
          <span className="text-amber-800 text-sm font-medium">
            {r.type === "allergy" ? <b className="text-red-700">⚠️ Table {r.table_number} has a food allergy: please go to the table before it&apos;s cooked</b>
              : <>{r.type === "waiter" ? "🙋" : "🧾"} Table {r.table_number} {r.type === "waiter" ? "wants a waiter" : "requested the bill"}</>}
          </span>
          <button
            onClick={() => resolve(r.id)}
            className="px-3 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 text-xs font-semibold rounded-lg transition-colors"
          >
            Resolve
          </button>
        </div>
      ))}
    </div>
  );
}
