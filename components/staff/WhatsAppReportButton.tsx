"use client";

import { useState } from "react";

// "📲 WhatsApp": opens WhatsApp with the day's report text (lib/day-end-text.ts),
// like the INSOMNIA sheet's WhatsApp tab. all = every business (group owner).
export default function WhatsAppReportButton({ date, all = false, label = "📲 WhatsApp" }: { date: string; all?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function go() {
    // Open the window straight away (inside the tap) so phones don't block it.
    const w = window.open("about:blank", "_blank");
    setBusy(true);
    const d = await fetch(`/api/staff/day-end-report?date=${date}${all ? "&all=1" : ""}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setBusy(false);
    if (!d?.url) { w?.close(); return; }
    if (w) w.location.href = d.url; else window.location.href = d.url;
    navigator.clipboard?.writeText(d.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => {});
  }
  return (
    <button type="button" onClick={go} disabled={busy} title="Open WhatsApp with this report (the text is also copied)"
      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60">
      {busy ? "Opening…" : copied ? "✓ Also copied (paste if needed)" : label}
    </button>
  );
}
