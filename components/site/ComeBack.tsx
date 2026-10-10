"use client";

import { useState } from "react";
import Link from "next/link";
import { WINBACK_REASONS, type WinBackReason } from "@/lib/winback-reasons";

// The customer's side of "Why did you stop coming?": confirm the reason (the
// email link pre-selects one), add a note if they like, and get the come-back
// code to show at the till.

type Offer = { code: string; rewardName: string; description: string | null; expiresAt: string };

const ukDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const NOTE: Record<WinBackReason, string> = {
  food: "We're sorry. Our chef will hear about this.",
  service: "We're sorry. Our manager will hear about this.",
  price: "Thank you for being honest.",
  distance: "We get it. Let us bring it to you.",
  waiting: "We're sorry you had to wait.",
  busy: "We understand, life gets busy!",
};

export default function ComeBack({ token, firstName, initialReason, offers, offer: initialOffer }: {
  token: string; firstName: string; initialReason: WinBackReason | null;
  offers: Partial<Record<WinBackReason, { name: string; description: string | null }>>; offer: Offer | null;
}) {
  const [reason, setReason] = useState<WinBackReason | null>(initialReason);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState<Offer | null>(initialOffer);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return setError("Please pick the reason that fits best.");
    setBusy(true);
    setError("");
    const res = await fetch("/api/public/come-back", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, reason, comment }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) return setError(d?.error ?? "Something went wrong. Please try again.");
    setOffer({ ...d.offer, description: d.offer.description ?? offers[reason]?.description ?? null });
  }

  if (offer) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">Thank you, {firstName}</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl">Here&apos;s something <span className="italic text-primary">on us</span></h1>
        <div className="mt-8 border border-primary/40 bg-card p-6">
          <p className="font-medium">{offer.rewardName.replace(/^Come-back:\s*/i, "")}</p>
          {offer.description && <p className="mt-1 text-sm text-muted-foreground">{offer.description}</p>}
          <p className="mt-5 text-xs uppercase tracking-[0.2em] text-muted-foreground">Your code</p>
          <p className="mt-1 select-all font-mono text-3xl font-bold tracking-[0.15em] text-primary">{offer.code}</p>
          <p className="mt-4 text-sm text-muted-foreground">Show this code when you order or pay. Valid until {ukDate(offer.expiresAt)}, once.</p>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/reservations" className="bg-primary px-6 py-3 text-xs uppercase tracking-[0.15em] text-primary-foreground hover:opacity-90">Book a table</Link>
          <Link href="/order" className="border border-border px-6 py-3 text-xs uppercase tracking-[0.15em] hover:border-primary hover:text-primary">Order online</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="mx-auto max-w-lg px-4 py-16">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">We miss you, {firstName}</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl">Why did you <span className="italic text-primary">stop coming?</span></h1>
        <p className="mt-2 text-sm text-muted-foreground">Pick the one that fits best. There&apos;s a thank-you on us either way.</p>
      </div>

      <fieldset className="mt-8 space-y-2">
        <legend className="sr-only">Reason</legend>
        {WINBACK_REASONS.map((r) => {
          const on = reason === r.key;
          return (
            <label key={r.key} className={`flex cursor-pointer items-start gap-3 border px-4 py-3.5 transition-colors ${on ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"}`}>
              <input type="radio" name="reason" value={r.key} checked={on} onChange={() => setReason(r.key)} className="mt-1 h-4 w-4 accent-primary" />
              <span>
                <span className="block font-medium">{r.guest}</span>
                {on && offers[r.key] && <span className="mt-0.5 block text-sm text-primary">{NOTE[r.key]} {offers[r.key]!.description ?? offers[r.key]!.name}.</span>}
              </span>
            </label>
          );
        })}
      </fieldset>

      <label className="mt-6 block">
        <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Anything else you&apos;d like to tell us? (optional)</span>
        <textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
          className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
      </label>

      {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !reason}
        className="mt-6 w-full bg-primary px-6 py-3.5 text-xs uppercase tracking-[0.2em] text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {busy ? "Getting your offer…" : "Send & get my offer"}
      </button>
    </form>
  );
}
