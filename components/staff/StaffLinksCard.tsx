"use client";

import { useEffect, useState } from "react";

// Settings → General: the staff link (Day End + Cash In / Out forms, staff PIN
// only, no Staff Hub login). Share it or print the QR for the wall.
export default function StaffLinksCard() {
  const [data, setData] = useState<{ url: string; qr: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/staff/staff-links").then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}); }, []);
  if (!data) return null;

  async function renew() {
    if (!window.confirm("Make a new link? The old link and QR stop working straight away.")) return;
    setBusy(true);
    const d = await fetch("/api/staff/staff-links", { method: "POST" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setBusy(false);
    if (d) setData(d);
  }
  function print() {
    const w = window.open("", "_blank");
    if (!w || !data?.qr) return;
    w.document.write(`<html><head><title>Staff forms</title></head><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>Staff forms</h1><p>Day End · Cash In / Out</p><div style="width:320px;margin:20px auto">${data.qr}</div><p>Scan, then enter your PIN</p></body></html>`);
    w.document.close();
    w.print();
  }

  return (
    <div className="mb-5 rounded-xl border border-border bg-white p-4">
      <h3 className="text-sm font-semibold">Staff links: Day End &amp; Cash In / Out</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Anyone with a till PIN can fill these in on their phone. No Staff Hub login; they can only enter, never see figures.</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {data.qr && <div className="h-32 w-32 shrink-0" dangerouslySetInnerHTML={{ __html: data.qr }} />}
        <div className="min-w-0 flex-1 space-y-2">
          <input readOnly value={data.url} onFocus={(e) => e.target.select()} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs" />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { navigator.clipboard?.writeText(data.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">{copied ? "Copied ✓" : "Copy link"}</button>
            <button onClick={print} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Print QR</button>
            <button onClick={renew} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">Make a new link</button>
          </div>
        </div>
      </div>
    </div>
  );
}
