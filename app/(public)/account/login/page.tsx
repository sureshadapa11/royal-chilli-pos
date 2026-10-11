"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { normalizeUkMobile } from "@/lib/phone";
import { MONTHS } from "@/lib/birthday";
import { freshStart } from "@/lib/auth-sync";

function AuthForm() {
  const params = useSearchParams();
  // Bring a Friend (?ref=) and "claim your points" (?next=/claim…) arrive here
  const referralCode = (params.get("ref") || "").trim();
  const next = params.get("next") || "";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  const initialMode = params.get("mode") === "signup" || referralCode ? "signup" : "login";
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [bDay, setBDay] = useState("");
  const [bMonth, setBMonth] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError("");
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Please enter your name");
      return;
    }
    if (mode === "signup" && !normalizeUkMobile(mobile)) {
      setError("Please enter your UK mobile number (starts with 07)");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/account/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { name, phone: mobile, email, password, marketingConsent, referralCode: referralCode || undefined, birthday: bDay && bMonth ? { day: Number(bDay), month: Number(bMonth) } : undefined } : { email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      // A new account lands on Loyalty, where its welcome voucher is waiting.
      freshStart(safeNext || (mode === "signup" ? "/account/loyalty" : "/account"), "customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/95 via-primary to-foreground px-6 py-10 text-primary-foreground">
      <div className="mx-auto max-w-sm">
        <div className="text-center">
          <Image src="/logo.png" alt="The Royal Chilli" width={72} height={72} className="mx-auto rounded-2xl object-cover shadow-lg" />
          <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-300/40 px-3.5 py-1.5 text-xs text-amber-200">
            The Royal Chilli · Hounslow
          </span>
          <h1 className="mt-4 font-[family-name:var(--font-playfair)] text-3xl">My Account</h1>
          <p className="mt-1 text-sm text-primary-foreground/70">Order, earn points and book a table — all in one place.</p>
          {mode === "signup" && referralCode && (
            <p className="mt-2 rounded-lg bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100">🎉 A friend invited you to our Rewards Club</p>
          )}
          {mode === "signup" && (
            <p className="mt-2 text-sm font-semibold text-amber-200">Sign up for 200 points and 20% off your next dine-in visit (up to £20). Earn 10 points per £1 — double Tue–Thu.</p>
          )}
        </div>

        <div className="mt-7 rounded-2xl border border-amber-300/20 bg-white/5 p-5 backdrop-blur">
          <div className="mb-4 flex rounded-xl bg-black/25 p-1">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === "login" ? "bg-primary text-primary-foreground" : "text-primary-foreground/70"}`}
            >
              Log in
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === "signup" ? "bg-primary text-primary-foreground" : "text-primary-foreground/70"}`}
            >
              Sign up
            </button>
          </div>

          {mode === "signup" && (
            <div className="mb-3">
              <label className="mb-1 block text-xs text-primary-foreground/70">Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aarav Sharma"
                className="w-full rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-amber-300"
              />
            </div>
          )}
          {mode === "signup" && (
            <div className="mb-3">
              <label className="mb-1 block text-xs text-primary-foreground/70">Mobile number</label>
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                type="tel"
                inputMode="tel"
                placeholder="07…"
                className="w-full rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-amber-300"
              />
              <p className="mt-1 text-[11px] text-primary-foreground/50">So we can find your points when you dine in.</p>
            </div>
          )}
          <div className="mb-3">
            <label className="mb-1 block text-xs text-primary-foreground/70">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@email.com"
              className="w-full rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-amber-300"
            />
          </div>
          <div className="mb-1">
            <label className="mb-1 block text-xs text-primary-foreground/70">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-amber-300"
            />
          </div>
          {mode === "signup" && (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-primary-foreground/70">Your birthday (optional)</label>
              <div className="flex gap-2">
                <select aria-label="Birthday day" value={bDay} onChange={(e) => setBDay(e.target.value)} className="w-24 rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300">
                  <option value="" className="text-black">Day</option>
                  {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1} className="text-black">{i + 1}</option>)}
                </select>
                <select aria-label="Birthday month" value={bMonth} onChange={(e) => setBMonth(e.target.value)} className="flex-1 rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300">
                  <option value="" className="text-black">Month</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1} className="text-black">{m}</option>)}
                </select>
              </div>
              <p className="mt-1 text-[11px] text-primary-foreground/50">We&apos;ll send you a birthday treat. No year needed.</p>
            </div>
          )}
          {mode === "signup" && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs text-primary-foreground/70">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-amber-300/40 bg-white/5 accent-primary"
              />
              Send me offers, news and updates from The Royal Chilli. You can unsubscribe any time.
            </label>
          )}
          {error && <p className="mt-2 text-xs text-red-200">{error}</p>}

          <button
            onClick={submit}
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-primary hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
          {mode === "signup" && (
            <p className="mt-2 text-center text-[11px] text-primary-foreground/60">
              By creating an account you join our Rewards Club and agree to its{" "}
              <Link href="/rewards-terms" className="underline">terms</Link>.
            </p>
          )}

          {mode === "login" && (
            <p className="mt-3 text-center text-xs text-primary-foreground/70">
              <Link href="/account/forgot-password" className="underline">Forgot password?</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AccountLoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm />
    </Suspense>
  );
}
