"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export default function PinPad() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const submit = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      if (res.ok) {
        // Full load so the till starts fresh as this person. Kitchen staff
        // go straight to the Kitchen Display — it's all they use.
        const data = await res.json().catch(() => ({}));
        window.location.replace(data?.user?.role === "kitchen" ? "/pos/kitchen" : "/pos");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Wrong PIN");
      setPin("");
    } catch {
      setError("Connection error — try again.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setError("");
    if (next.length === 4) submit(next);
  };

  // Typing on a keyboard works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const key = "h-16 rounded-xl bg-surface-hover text-2xl font-bold text-foreground active:bg-elevated disabled:opacity-50";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-xs text-center">
        <div className="mb-4 flex items-center justify-center gap-3">
          <Image src="/logo.png" alt="" width={44} height={44} className="rounded-xl object-cover" />
          <span className="text-xl font-bold text-foreground" style={{ fontFamily: "var(--font-cinzel)" }}>The Royal Chilli</span>
        </div>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground" suppressHydrationWarning>
          {now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}
        </p>
        <div className="mt-4 rounded-2xl border border-border bg-surface p-6 shadow-xl">
          <h1 className="text-lg font-bold text-foreground">Enter your PIN</h1>
          <div className="my-4 flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-4 w-4 rounded-full border-2 ${i < pin.length ? "border-foreground bg-foreground" : "border-muted-foreground"}`} />
            ))}
          </div>
          <p className="mb-2 min-h-5 text-sm font-semibold text-red-600">{error}</p>
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} onClick={() => press(d)} disabled={busy} className={key}>{d}</button>
            ))}
            <button onClick={() => { setPin(""); setError(""); }} className="h-16 rounded-xl bg-surface-hover text-sm font-semibold text-muted-foreground">Clear</button>
            <button onClick={() => press("0")} disabled={busy} className={key}>0</button>
            <button onClick={() => setPin((p) => p.slice(0, -1))} className="h-16 rounded-xl bg-surface-hover text-xl text-muted-foreground">⌫</button>
          </div>
        </div>
        <a href="/login" className="mt-4 inline-block text-xs text-muted-foreground underline">Manager: sign in with password</a>
      </div>
    </div>
  );
}
