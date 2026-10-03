"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SwitcherOption = { id: number; name: string; active: boolean };

// The group owner's "Working in" picker (Staff Hub header). Switching gives a
// fresh login for that business and reloads the Hub inside it.
export default function BusinessSwitcher({ current, options, allMode = false, className = "" }: {
  current: number; options: SwitcherOption[]; allMode?: boolean; className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // "all" = the dashboard shows every business combined (lib/owner-view).
  async function change(id: number | "all") {
    if (id === (allMode ? "all" : current)) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/switch-business", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: id }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Couldn't switch");
      return;
    }
    router.push("/staff");
    router.refresh();
  }

  return (
    <label className={`flex items-center gap-2 text-[12.5px] text-muted-foreground ${className}`}>
      <span className="whitespace-nowrap">Working in</span>
      <select
        id="owner-business-switcher"
        value={allMode ? "all" : current}
        disabled={busy}
        onChange={(e) => change(e.target.value === "all" ? "all" : Number(e.target.value))}
        className="max-w-[190px] rounded-lg border border-border bg-[#F6F1E6] px-2 py-1.5 text-[13px] font-semibold text-foreground"
      >
        <option value="all">All businesses</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}{o.active ? "" : " (not open yet)"}</option>
        ))}
      </select>
      {error && <span className="text-[#E34435]">{error}</span>}
    </label>
  );
}
