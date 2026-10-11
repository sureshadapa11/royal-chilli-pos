"use client";

import { useState } from "react";

// Staff Hub → Customers → Redemptions: "Check & use a code" — for reward codes
// shown while the till isn't being used. Check shows what the code is and
// whether it can be used (same checks as the till); Mark as used records it
// so it can't be used again. Staff give the discount on whatever takes payment.

type Result = {
  code?: string;
  customer?: { name: string; phone: string | null } | null;
  terms?: { name: string; description: string | null; orderTypes: string | null; minSpend: number | null; expiresAt: string };
  usable?: boolean; used?: boolean; discount?: number | null; message?: string;
};

const ukDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const gbp = (n: number) => `£${n.toFixed(2)}`;

export default function UseCodeBox({ onUsed }: { onUsed: () => void }) {
  const [code, setCode] = useState("");
  const [bill, setBill] = useState("");
  const [orderType, setOrderType] = useState("dine_in");
  const [busy, setBusy] = useState<null | "check" | "use">(null);
  const [result, setResult] = useState<Result | null>(null);

  async function send(confirm: boolean) {
    if (!code.trim()) return;
    setBusy(confirm ? "use" : "check");
    const res = await fetch("/api/loyalty/redemptions/use", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, bill: bill || null, order_type: orderType, confirm }),
    }).catch(() => null);
    setBusy(null);
    const data: Result = (await res?.json().catch(() => null)) ?? { message: "Couldn't reach the server. Please try again." };
    setResult(data);
    if (data.used) onUsed();
  }

  const t = result?.terms;
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <h3 className="text-sm font-semibold">Check &amp; use a code</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">For codes shown while the till isn&apos;t in use. Check it, give the discount, then mark it used so it can&apos;t be used again.</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(false); }}>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-muted-foreground">Code</span>
          <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setResult(null); }} placeholder="e.g. 3UBDE3S7" autoCapitalize="characters" spellCheck={false}
            className="w-40 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm tracking-[2px]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-muted-foreground">Order</span>
          <select value={orderType} onChange={(e) => { setOrderType(e.target.value); setResult(null); }} className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm">
            <option value="dine_in">Dine-in</option><option value="takeaway">Collection</option><option value="delivery">Delivery</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-muted-foreground">Bill £ (needed to use)</span>
          <input value={bill} onChange={(e) => { setBill(e.target.value.replace(/[^0-9.]/g, "")); setResult(null); }} inputMode="decimal" placeholder="0.00"
            className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-right text-sm tabular-nums" />
        </label>
        <button type="submit" disabled={!code.trim() || !!busy} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50">
          {busy === "check" ? "Checking…" : "Check"}
        </button>
      </form>

      {result && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${result.used ? "border-emerald-300 bg-emerald-50" : result.usable ? "border-blue-200 bg-blue-50/50" : "border-red-200 bg-red-50"}`} role="status">
          {result.used ? (
            <p className="font-semibold text-emerald-800">✓ {result.code} marked as used{result.discount != null ? `. Give ${gbp(result.discount)} off.` : "."}</p>
          ) : !result.usable ? (
            <p className="font-semibold text-red-700">✗ {result.message ?? "This code can't be used"}</p>
          ) : (
            <p className="font-semibold text-blue-800">✓ Valid. It can be used now</p>
          )}
          {t && (
            <div className="mt-2 space-y-0.5 text-[13px] text-foreground">
              <p><b>{t.name}</b>{t.description ? ` · ${t.description}` : ""}</p>
              {result.customer && <p className="text-muted-foreground">For {result.customer.name}{result.customer.phone ? ` · ${result.customer.phone}` : ""}</p>}
              <p className="text-muted-foreground">
                {t.orderTypes ? `${t.orderTypes} only · ` : ""}{t.minSpend ? `min. spend ${gbp(t.minSpend)} · ` : ""}valid until {ukDate(t.expiresAt)}
              </p>
              {result.usable && result.discount != null && <p>Discount on a {gbp(Number(bill))} bill: <b>{gbp(result.discount)}</b>{result.discount === 0 ? " (no money off: hand the item over / seat them first)" : ""}</p>}
            </div>
          )}
          {result.usable && !result.used && (
            <button onClick={() => void send(true)} disabled={!!busy} className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
              {busy === "use" ? "Saving…" : "Mark as used"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
