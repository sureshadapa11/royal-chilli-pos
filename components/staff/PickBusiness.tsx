"use client";

import { useState } from "react";
import Link from "next/link";
import type { SwitcherOption } from "@/components/staff/BusinessSwitcher";
import { freshStart } from "@/lib/auth-sync";

// Shown over any Staff Hub page except the dashboard while the owner has
// "Working in: All businesses" on: pages like Menu, Inventory or HR change one
// business's data, so the owner picks which business first.
export default function PickBusiness({ options }: { options: SwitcherOption[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function pick(id: number) {
    setBusy(id);
    setError("");
    const res = await fetch("/api/auth/switch-business", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: id }),
    });
    setBusy(null);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Couldn't switch");
    freshStart(window.location.pathname + window.location.search);
  }

  return (
    <div className="fixed inset-0 z-[45] grid place-items-center bg-[rgba(20,12,8,0.4)] p-4" role="dialog" aria-modal="true" aria-labelledby="pick-business-title">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-5 shadow-[0_12px_30px_rgba(40,25,15,0.18)]">
        <h2 id="pick-business-title" className="text-lg font-bold text-foreground">Which business?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You&apos;re viewing all businesses. This page changes one business&apos;s data — pick which one.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {options.map((o) => (
            <button key={o.id} type="button" disabled={busy !== null} onClick={() => pick(o.id)}
              className="rounded-xl border border-border px-4 py-3 text-left text-[15px] font-semibold hover:bg-[#F6F1E6] disabled:opacity-60">
              {busy === o.id ? "Switching…" : o.name}{o.active ? "" : " (not open yet)"}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <Link href="/staff" className="mt-4 block text-center text-sm font-semibold text-[#C82D1D] hover:underline">← Back to the all-businesses dashboard</Link>
      </div>
    </div>
  );
}
