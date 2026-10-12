"use client";

import { useEffect, useState } from "react";

// Settings → General (Super admin): whether the till is in use. While it's off,
// the dashboard hides its till cards (revenue by hour / channel, top dishes,
// average spend) and works from Daily accounts only.
export default function TillInUseCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings").then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOn(String(d.settings?.till_in_use ?? "") === "1")).catch(() => {});
  }, []);

  const change = async (next: boolean) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ till_in_use: next ? "1" : "0" }) });
    if (res.ok) setOn(next);
    else setError("Couldn't save. Please try again.");
    setBusy(false);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-bold text-foreground">Till in use</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {on === null ? "Checking…" : on
          ? "✅ On: the dashboard shows the till cards (revenue by hour and channel, top-selling dishes, average spend)."
          : "Off: the dashboard hides the till cards and uses your Daily accounts only. Turn on when you start taking orders on the till."}
      </p>
      {on !== null && (
        <button type="button" disabled={busy} onClick={() => change(!on)}
          className={`mt-3 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${on ? "border border-border text-foreground hover:bg-surface-hover" : "bg-red-600 text-white hover:bg-red-500"}`}>
          {busy ? "Saving…" : on ? "Turn off (hide till cards)" : "Turn on (show till cards)"}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
