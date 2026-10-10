"use client";

import { useState } from "react";
import Link from "next/link";
import { FEEDBACK_TOPICS, type FeedbackTopic } from "@/lib/feedback";

// The guest's side of "How was your meal?": stars, what was great, what could
// be better, an optional comment and contact details. The thank-you screen
// offers the Google review link to every guest, whatever they rated (Google's
// rules: no asking only happy guests).

const STAR_WORDS = ["", "Poor", "Not great", "OK", "Good", "Excellent"];

function Chips({ label, value, onChange }: { label: string; value: FeedbackTopic[]; onChange: (v: FeedbackTopic[]) => void }) {
  return (
    <fieldset className="mt-6">
      <legend className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {FEEDBACK_TOPICS.map((t) => {
          const on = value.includes(t.key);
          return (
            <button key={t.key} type="button" aria-pressed={on}
              onClick={() => onChange(on ? value.filter((k) => k !== t.key) : [...value, t.key])}
              className={`border px-3.5 py-2 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary hover:text-primary"}`}>
              {t.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function FeedbackForm({ businessName, reviewUrl, table, source, businessParam }: {
  businessName: string; reviewUrl: string | null; table: string | null; source: string; businessParam: string | null;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [liked, setLiked] = useState<FeedbackTopic[]>([]);
  const [improve, setImprove] = useState<FeedbackTopic[]>([]);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setError("Please choose 1 to 5 stars.");
    setBusy(true);
    setError("");
    const res = await fetch(`/api/public/feedback${businessParam ? `?b=${encodeURIComponent(businessParam)}` : ""}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, liked, improve, comment, name, phone, email, contact_ok: contactOk, source, table, website }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}));
      return setError(d?.error ?? "Couldn't send your feedback. Please try again.");
    }
    setSent(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (sent) {
    const happy = rating >= 4;
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">Thank you</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl">
          {happy ? <>We&apos;re so glad you <span className="italic text-primary">enjoyed it</span></> : <>Thank you for <span className="italic text-primary">telling us</span></>}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-muted-foreground">
          {happy
            ? `Your feedback goes straight to the team at ${businessName}.`
            : contactOk
              ? "Your feedback has gone straight to our manager, who will be in touch to put things right."
              : "Your feedback has gone straight to our manager, and we'll use it to do better."}
        </p>
        {reviewUrl && (
          <div className="mt-10 border border-border bg-card p-6">
            <p className="font-medium">Would you share your experience on Google?</p>
            <p className="mt-1 text-sm text-muted-foreground">An honest review helps other people find a local restaurant like ours.</p>
            <a href={reviewUrl} target="_blank" rel="noopener noreferrer"
              className="mt-5 inline-block bg-primary px-6 py-3 text-xs uppercase tracking-[0.15em] text-primary-foreground hover:opacity-90">
              Leave a Google review
            </a>
          </div>
        )}
        <Link href="/menu" className="mt-8 inline-block text-xs uppercase tracking-[0.15em] text-primary underline underline-offset-4">See our menu</Link>
      </div>
    );
  }

  const shown = hover || rating;
  return (
    <form onSubmit={submit} className="mx-auto max-w-lg px-4 py-16" noValidate>
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">{table ? `Table ${table}` : businessName}</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl md:text-4xl">
          How was your <span className="italic text-primary">meal?</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">It takes less than a minute, and every answer is read by our team.</p>
      </div>

      <fieldset className="mt-10 text-center">
        <legend className="sr-only">Your rating</legend>
        <div className="flex justify-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}: ${STAR_WORDS[n]}`} aria-pressed={rating === n}
              onMouseEnter={() => setHover(n)} onClick={() => setRating(n)}
              className="p-1 text-[44px] leading-none transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <span className={n <= shown ? "text-[#E2A33A]" : "text-border"}>★</span>
            </button>
          ))}
        </div>
        <p className="mt-2 h-5 text-sm font-medium text-primary">{STAR_WORDS[shown]}</p>
      </fieldset>

      {rating > 0 && (
        <>
          {rating <= 3 ? (
            <>
              <Chips label="What could be better?" value={improve} onChange={setImprove} />
              <Chips label="Anything you liked?" value={liked} onChange={setLiked} />
            </>
          ) : (
            <>
              <Chips label="What did you love?" value={liked} onChange={setLiked} />
              <Chips label="Anything we could do better?" value={improve} onChange={setImprove} />
            </>
          )}

          <label className="mt-6 block">
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Tell us more (optional)</span>
            <textarea rows={4} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder={rating <= 3 ? "What happened? Which dish?" : "Which dish did you enjoy most?"}
              className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            <span className="mt-1 block text-xs text-muted-foreground">English, తెలుగు, हिन्दी or any language is fine.</span>
          </label>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Your name (optional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80}
                className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Mobile (optional)</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={30}
                className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Email (optional)</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" maxLength={200}
                className="mt-2 w-full border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </label>
          </div>
          {(phone || email) && (
            <label className="mt-3 flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>You can contact me about my feedback</span>
            </label>
          )}
          <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

          {error && <p className="mt-5 text-sm text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={busy}
            className="mt-8 w-full bg-primary px-6 py-3.5 text-xs uppercase tracking-[0.2em] text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {busy ? "Sending…" : "Send feedback"}
          </button>
          <p className="mt-3 text-center text-xs text-muted-foreground">We only use your details to reply to this feedback.</p>
        </>
      )}
    </form>
  );
}
