"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { siteContent } from "@/lib/site-content";
import Reveal from "@/components/site/Reveal";
import { getScheduleSlotOptions, toDateInputValue } from "@/lib/hours";
import { isValidEmail, isValidUkMobile } from "@/lib/utils";
import { useWeekHours } from "@/components/site/HoursProvider";
import AllergyQuestion from "@/components/site/AllergyQuestion";
import { NO_ANSWER, allergyPayload, allergyProblem, type AllergyAnswer } from "@/lib/allergy";

type Result = { status: "full" | "waitlisted" | "booked" };

export default function ReservationsPage() {
  return (
    <Suspense>
      <ReservationsForm />
    </Suspense>
  );
}

function ReservationsForm() {
  const { reservation, contact } = siteContent;
  const searchParams = useSearchParams();
  const depositRedirect = searchParams.get("deposit");
  const depositReservationId = searchParams.get("reservation_id");
  const [depositPaid, setDepositPaid] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [notes, setNotes] = useState("");
  // "Does anyone in your party have a food allergy?" (agreed 2026-10-14).
  const [allergy, setAllergy] = useState<AllergyAnswer>(NO_ANSWER);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Every valid quarter-hour slot for the chosen date, restricted to that
  // day's real opening hours (Settings → General) — same helper the checkout page uses
  // for "Schedule for later", so a customer can never pick a time we're shut.
  const week = useWeekHours();
  const timeSlots = date ? getScheduleSlotOptions(week, new Date(`${date}T00:00:00`)) : [];

  // Keep the selected time inside the current date's valid slots — e.g.
  // changing the date could otherwise leave a stale slot the new day doesn't offer.
  useEffect(() => {
    if (timeSlots.length > 0 && !timeSlots.some((s) => s.value === time)) {
      setTime(timeSlots[0].value);
    } else if (timeSlots.length === 0 && time) {
      setTime("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // On return from Stripe Checkout we re-check the real deposit status from
  // the webhook-updated record rather than trusting the redirect itself.
  useEffect(() => {
    if (depositRedirect !== "return" || !depositReservationId) return;
    fetch(`/api/public/reservations/${depositReservationId}`)
      .then((r) => r.json())
      .then((d) => setDepositPaid(!!d.paid))
      .catch(() => setDepositPaid(false));
  }, [depositRedirect, depositReservationId]);

  async function submit(joinWaitlist = false) {
    setError("");
    if (!name.trim() || !phone.trim() || !email.trim() || !date || !time) {
      setError("Please fill in your name, phone, email, date and time.");
      return;
    }
    if (!isValidUkMobile(phone)) {
      setError("Please enter a valid UK mobile number (starts with 07, 11 digits).");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    const allergyIssue = allergyProblem(allergy);
    if (allergyIssue) {
      setError(allergyIssue);
      return;
    }

    setSubmitting(true);
    // `time` is a full local "YYYY-MM-DDTHH:MM" — split rather than reusing
    // the separate date picker's value, since a post-midnight slot actually
    // falls on the day after the date the customer picked.
    const [reservationDate, reservationTime] = time.split("T");
    try {
      const res = await fetch("/api/public/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          customer_email: email.trim(),
          party_size: guests,
          reservation_date: reservationDate,
          reservation_time: reservationTime,
          notes: notes.trim() || undefined,
          allergy: allergyPayload(allergy),
          join_waitlist: joinWaitlist,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong — please try again or call us.");
        return;
      }
      if (data.full) {
        setResult({ status: "full" });
        return;
      }
      // Only meaningful once a deposit is configured in Settings — otherwise
      // deposit_amount is 0 and this never fires.
      if (data.deposit_amount > 0 && !data.waitlisted) {
        const csRes = await fetch(`/api/public/reservations/${data.id}/checkout-session`, { method: "POST" });
        const csData = await csRes.json();
        if (csData.url) {
          window.location.href = csData.url;
          return;
        }
      }
      setResult({ status: data.waitlisted ? "waitlisted" : "booked" });
    } catch {
      setError("Something went wrong — please try again or call us.");
    } finally {
      setSubmitting(false);
    }
  }

  if (depositRedirect === "return") {
    if (depositPaid === null) {
      return <div className="mx-auto max-w-md px-4 py-24 text-center text-muted-foreground">Checking payment status…</div>;
    }
    if (depositPaid) {
      return (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <div className="text-5xl">✅</div>
          <h1 className="mt-4 font-[family-name:var(--font-playfair)] text-2xl">Deposit Paid — Table Confirmed!</h1>
          <p className="mt-2 text-muted-foreground">We'll see you soon. Questions? Call us on {contact.phone}.</p>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="text-5xl">⚠️</div>
        <h1 className="mt-4 font-[family-name:var(--font-playfair)] text-2xl">Deposit Payment Not Completed</h1>
        <p className="mt-2 text-muted-foreground">
          Your booking request is still held, but the deposit hasn&apos;t been paid yet. Call us on {contact.phone} to sort this out, or try booking again.
        </p>
      </div>
    );
  }

  if (result?.status === "booked" || result?.status === "waitlisted") {
    const waitlisted = result.status === "waitlisted";
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="text-5xl">{waitlisted ? "⏳" : "✅"}</div>
        <h1 className="mt-4 font-[family-name:var(--font-playfair)] text-2xl">
          {waitlisted ? "You're On The Waitlist" : "Table Booked!"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {waitlisted
            ? "That time is fully booked, but we've added you to the waitlist — we'll be in touch if a table frees up."
            : "We've got your reservation and sent a confirmation to your email."}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Questions? Call us on {contact.phone}.</p>
      </div>
    );
  }

  if (result?.status === "full") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="text-5xl">📅</div>
        <h1 className="mt-4 font-[family-name:var(--font-playfair)] text-2xl">That Time Is Fully Booked</h1>
        <p className="mt-2 text-muted-foreground">We don&apos;t have a table free for that slot. Want to join the waitlist, or pick a different time?</p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className="w-full bg-primary px-6 py-3 text-xs uppercase tracking-[0.15em] text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Joining…" : "Join The Waitlist"}
          </button>
          <button
            onClick={() => setResult(null)}
            className="w-full border border-border px-6 py-3 text-xs uppercase tracking-[0.15em] hover:bg-surface-hover"
          >
            Pick A Different Time
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <Reveal className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">{reservation.tag}</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl">
          {reservation.title} <span className="italic text-primary">{reservation.titleGold}</span>
        </h1>
        <p className="mt-3 text-muted-foreground">{reservation.desc}</p>
      </Reveal>

      <div className="mt-10 rounded-2xl border border-border bg-background p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">A table gets assigned later, when you arrive.</p>
        <div className="mt-4 space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="w-full border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Mobile number (07…)"
          type="tel"
          inputMode="numeric"
          maxLength={11}
          className="w-full border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter email to get booking confirmation"
          type="email"
          required
          className="w-full border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
        />
        <div className="grid grid-cols-2 gap-3">
          {/* Native date/time inputs ignore the placeholder attribute on
              mobile, so an empty box gives no hint of the expected format
              until tapped — a plain text label above each fixes that. */}
          <label className="block text-left">
            <span className="text-xs text-muted-foreground">Date</span>
            {/* iOS Safari renders type="date" with its own native chrome —
                ignoring our border/padding/height and following the OS's
                color scheme — unless appearance is reset and color-scheme is
                pinned to light. Without this it can render as a blank,
                oddly-sized box, which is exactly the broken layout reported. */}
            <input
              type="date"
              value={date}
              min={toDateInputValue(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 h-11 w-full appearance-none border border-border bg-background px-4 text-sm outline-none focus:border-primary [color-scheme:light]"
            />
          </label>
          <label className="block text-left">
            <span className="text-xs text-muted-foreground">Time</span>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!date}
              className="mt-1 h-11 w-full border border-border bg-background px-4 text-sm outline-none focus:border-primary disabled:opacity-50 [color-scheme:light]"
            >
              {!date ? (
                <option value="">Pick a date first</option>
              ) : timeSlots.length === 0 ? (
                <option value="">No slots left that day</option>
              ) : (
                timeSlots.map((slot) => (
                  <option key={slot.value} value={slot.value}>{slot.label}</option>
                ))
              )}
            </select>
          </label>
        </div>
        {date && timeSlots.length === 0 && (
          <p className="text-xs text-red-500">No more slots that day — please choose a different date.</p>
        )}
        <div className="flex items-center justify-between border border-border px-4 py-2.5">
          <span className="text-sm text-muted-foreground">Number of guests</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setGuests((g) => Math.max(1, g - 1))} className="h-9 w-9 border border-border">−</button>
            <span className="w-4 text-center">{guests}</span>
            <button onClick={() => setGuests((g) => g + 1)} className="h-9 w-9 border border-border">+</button>
          </div>
        </div>
        <AllergyQuestion value={allergy} onChange={(v) => { setAllergy(v); setError(""); }} who="in your party" />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Special requests (optional)"
          rows={3}
          className="w-full border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
        />
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <button
          onClick={() => submit(false)}
          disabled={submitting}
          className="mt-6 w-full bg-primary px-6 py-3 text-xs uppercase tracking-[0.15em] text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Booking…" : "Book Table"}
        </button>
      </div>
    </div>
  );
}
