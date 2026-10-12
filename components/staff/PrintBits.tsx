"use client";

import { useBrand } from "@/components/pos/useBrand";

// Printing for the Insights pages (agreed 2026-10-12): each tab has its own
// Print button, and the paper copy starts with the business, the page/tab
// and the dates. Controls (tabs, date boxes, buttons) carry print:hidden.

const ukDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function rangeLabel(from?: string, to?: string): string {
  if (!from) return "";
  return !to || from === to ? ukDate(from) : `${ukDate(from)} – ${ukDate(to)}`;
}

/** Only on paper: "The Royal Chilli · Finance · Profit & Loss", dates, printed time. */
export function PrintHeader({ title, from, to, note }: { title: string; from?: string; to?: string; note?: string }) {
  const brand = useBrand();
  const printed = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return (
    <div className="hidden print:block mb-3 border-b border-neutral-300 pb-2 text-black">
      <h1 className="text-lg font-bold">{brand?.name ? `${brand.name} · ` : ""}{title}</h1>
      <p className="text-sm text-neutral-600">
        {[rangeLabel(from, to) || note, `Printed ${printed}`].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

export function PrintButton({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" onClick={() => window.print()} disabled={disabled}
      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-hover disabled:opacity-40 print:hidden">
      🖨️ Print
    </button>
  );
}
