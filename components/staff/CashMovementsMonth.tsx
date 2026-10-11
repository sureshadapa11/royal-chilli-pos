"use client";

import { useEffect, useState } from "react";
import { ReceiptLinks } from "@/components/staff/ReceiptPhotos";

// Staff Hub → Daily accounts → Cash in/out: what staff entered through the
// staff links this month (Cash In / Out entries and who sent each Day End).
type Move = { id: number; movement_date: string; direction: "in" | "out"; categoryLabel: string; methodLabel: string; amount: number; reason: string; paid_to: string | null; by: string; created_at: string; photos: { id: number }[]; possibleDuplicate: string | null };
type DayEnd = { date: string; by: string; via: string | null; photos: { id: number }[] };

const gbp = (n: number) => `£${n.toFixed(2)}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export default function CashMovementsMonth({ startMonth }: { startMonth: string }) {
  const [month, setMonth] = useState(startMonth);
  const [data, setData] = useState<{ movements: Move[]; dayEnds: DayEnd[] } | null>(null);
  const load = () => fetch(`/api/staff/cash-movements?month=${month}`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  useEffect(() => { setData(null); load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  async function remove(m: Move) {
    if (!window.confirm(`Delete ${m.categoryLabel} £${m.amount.toFixed(2)}? Anything it created (the expense, supplier payment or staff advance) is removed too.`)) return;
    const res = await fetch(`/api/staff/cash-movements?id=${m.id}`, { method: "DELETE" });
    if (!res.ok) { window.alert((await res.json().catch(() => ({})))?.error ?? "Couldn't delete"); return; }
    load();
  }
  const totalIn = data?.movements.filter((m) => m.direction === "in").reduce((s, m) => s + m.amount, 0) ?? 0;
  const totalOut = data?.movements.filter((m) => m.direction === "out").reduce((s, m) => s + m.amount, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        {data && <span className="text-sm text-muted-foreground">In <b className="text-emerald-700">{gbp(totalIn)}</b> · Out <b className="text-red-700">{gbp(totalOut)}</b></span>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#F6F1E6] text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">In / Out</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Paid by</th><th className="px-3 py-2">Note</th><th className="px-3 py-2">Paid to / from</th><th className="px-3 py-2">Entered by</th><th className="px-3 py-2">Photo</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {!data ? <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              : data.movements.length === 0 ? <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No money in / out entered this month.</td></tr>
              : data.movements.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{day(m.movement_date)}</td>
                  <td className={`px-3 py-2 font-semibold ${m.direction === "out" ? "text-red-700" : "text-emerald-700"}`}>{m.direction === "out" ? "Out" : "In"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gbp(m.amount)}</td>
                  <td className="px-3 py-2 font-medium">{m.categoryLabel}</td>
                  <td className="px-3 py-2">{m.methodLabel}</td>
                  <td className="px-3 py-2">{m.reason !== m.categoryLabel ? m.reason : ""}{m.possibleDuplicate && (
                    <div className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800" title="Same amount, same day. If it's the same spend, delete one so it isn't counted twice.">
                      ⚠ Possible duplicate: {m.possibleDuplicate}
                    </div>
                  )}</td>
                  <td className="px-3 py-2">{m.paid_to ?? "—"}</td>
                  <td className="px-3 py-2">{m.by}</td>
                  <td className="px-3 py-2"><ReceiptLinks photos={m.photos} /></td>
                  <td className="px-3 py-2 text-right"><button onClick={() => remove(m)} className="text-xs font-semibold text-red-600 hover:underline">Delete</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {data && data.dayEnds.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4">
          <h3 className="text-sm font-semibold">Day Ends entered</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {data.dayEnds.map((d) => (
              <li key={d.date} className="flex flex-wrap items-center gap-2">
                <span className="w-28">{day(d.date)}</span>
                <span className="text-muted-foreground">by {d.by}{d.via === "link" ? " (staff link)" : ""}</span>
                {d.photos.length > 0 && <ReceiptLinks photos={d.photos} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
