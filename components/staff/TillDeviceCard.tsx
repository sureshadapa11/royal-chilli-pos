"use client";

import { useEffect, useState } from "react";

// Settings → General: turns the device this page is open on into a till (or
// back). Staff then sign in on it with their PIN, and only a till can take
// orders and payments.
export default function TillDeviceCard() {
  const [state, setState] = useState<{ paired: boolean; otherBusiness: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/till/device").then((r) => (r.ok ? r.json() : null)).then((d) => d && setState(d)).catch(() => {});
  }, []);

  const change = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/till/device", { method });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setState({ paired: d.paired, otherBusiness: false });
    else setError(d.error || "Couldn't change this device");
    setBusy(false);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-bold text-foreground">This device</h2>
      {state === null ? (
        <p className="mt-1 text-sm text-muted-foreground">Checking…</p>
      ) : state.paired ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            ✅ This device is a till. Staff sign in on it with their 4-digit PIN, and it can take orders and payments.
          </p>
          <button type="button" disabled={busy} onClick={() => change("DELETE")}
            className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-hover disabled:opacity-60">
            {busy ? "Saving…" : "Stop using this device as a till"}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.otherBusiness
              ? "This device is a till for another business. Make it a till for this business instead?"
              : "Use this on the reception tablet: staff will sign in on it with their PIN, and it can take orders and payments."}
          </p>
          <button type="button" disabled={busy} onClick={() => change("POST")}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60">
            {busy ? "Saving…" : "Make this device a till"}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
