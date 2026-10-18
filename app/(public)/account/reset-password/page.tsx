"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { PasswordInput } from "@/components/ui/password-input";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError("");
    if (!token) {
      setError("This reset link is missing its token — please request a new one");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/account/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/account/login"), 1500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/95 via-primary to-foreground px-6 py-10 text-primary-foreground">
      <div className="mx-auto max-w-sm">
        <div className="text-center">
          <Image src="/logo.png" alt="The Royal Chilli" width={72} height={72} className="mx-auto rounded-2xl object-cover shadow-lg" />
          <h1 className="mt-4 font-[family-name:var(--font-playfair)] text-3xl">Choose a new password</h1>
        </div>

        <div className="mt-7 rounded-2xl border border-amber-300/20 bg-white/5 p-5 backdrop-blur">
          {done ? (
            <p className="text-center text-sm text-primary-foreground/90">Password updated — taking you to login…</p>
          ) : (
            <>
              <div className="mb-3">
                <label className="mb-1 block text-xs text-primary-foreground/70">New password</label>
                <PasswordInput
                  toggleClassName="text-white/60 hover:text-white"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-amber-300"
                />
              </div>
              <div className="mb-1">
                <label className="mb-1 block text-xs text-primary-foreground/70">Confirm new password</label>
                <PasswordInput
                  toggleClassName="text-white/60 hover:text-white"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="w-full rounded-xl border border-amber-300/25 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-amber-300"
                />
              </div>
              {error && <p className="mt-2 text-xs text-red-200">{error}</p>}
              <button
                onClick={submit}
                disabled={saving}
                className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-primary hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save new password"}
              </button>
            </>
          )}

          <p className="mt-3 text-center text-xs text-primary-foreground/70">
            <Link href="/account/login" className="underline">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
