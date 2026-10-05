"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { initials } from "@/lib/brand-client";
import type { LoginBrand } from "@/lib/login-brand";
import { BUSINESS_COOKIE } from "@/lib/staff-business-code";
import { freshStart } from "@/lib/auth-sync";

const YEAR = 60 * 60 * 24 * 365;

const rememberCode = (code: string | null) => {
  document.cookie = code
    ? `${BUSINESS_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`
    : `${BUSINESS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
};

const field =
  "w-full bg-surface-hover border border-border rounded-lg px-4 py-3 text-foreground text-base focus:outline-none focus:border-red-500";
const panel =
  "bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_2px_rgba(32,27,24,0.04),0_8px_24px_rgba(32,27,24,0.05)]";

// Staff sign-in. Step 1 (only on the shared sign-in, when the address doesn't
// say which business): the business code. Step 2: that business's name and
// logo, username, password and Sign in — nothing else.
export default function LoginForm({ brand }: { brand: LoginBrand }) {
  return brand.found ? <SignIn brand={brand} /> : <BusinessCode badCode={brand.badCode} />;
}

function BusinessCode({ badCode }: { badCode: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState(badCode ? "Business code not found. Check it with your manager." : "");

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return setError("Enter your business code.");
    setError("");
    router.push(`/login?code=${encodeURIComponent(c)}`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-2xl font-bold text-foreground tracking-wide">Staff sign in</h1>
        <form onSubmit={next} className={panel}>
          <div>
            <label htmlFor="business-code" className="block text-sm font-semibold text-muted-foreground mb-1.5">
              Business code
            </label>
            <input
              id="business-code"
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              value={code}
              maxLength={8}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className={`${field} uppercase tracking-widest`}
            />
          </div>
          {error && (
            <div className="bg-red-100 border border-red-300 rounded-xl p-3 text-center text-red-700 text-sm" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="pos-btn no-select w-full h-12 bg-red-500 hover:bg-red-400 text-white text-base font-bold rounded-xl transition-all">
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}

function SignIn({ brand }: { brand: Extract<LoginBrand, { found: true }> }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, business_code: brand.code }),
      });
      const data = await res.json();
      if (res.ok) {
        if (brand.viaCode) rememberCode(brand.code);
        freshStart("/staff");
      } else {
        setError(data.error || "Username or password is incorrect. Contact your manager for account recovery.");
        setPassword("");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const changeBusiness = () => {
    rememberCode(null);
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} width={56} height={56} className="h-14 w-14 rounded-xl object-cover flex-shrink-0" />
          ) : (
            <span
              className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-xl bg-foreground text-lg font-bold text-background"
              style={brand.colour ? { backgroundColor: brand.colour, color: "#fff" } : undefined}
            >
              {initials(brand.name)}
            </span>
          )}
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-wide leading-tight" style={{ fontFamily: "var(--font-cinzel)" }}>
              Welcome to
            </h1>
            <h1
              className="text-2xl font-bold text-primary tracking-wide leading-tight"
              style={{ fontFamily: "var(--font-cinzel)", ...(brand.colour ? { color: brand.colour } : {}) }}
            >
              {brand.name}
            </h1>
          </div>
        </div>

        <form onSubmit={handleLogin} className={panel}>
          <div>
            <label htmlFor="username" className="block text-sm font-semibold text-muted-foreground mb-1.5">
              Username
            </label>
            <input id="username" name="username" type="text" autoComplete="username" autoFocus
              value={username} onChange={(e) => setUsername(e.target.value)} className={field} />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-muted-foreground mb-1.5">
              Password
            </label>
            <input id="password" name="password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          </div>

          {error && (
            <div className="bg-red-100 border border-red-300 rounded-xl p-3 text-center text-red-700 text-sm" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="pos-btn no-select w-full h-12 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-base font-bold rounded-xl transition-all"
            style={brand.colour ? { backgroundColor: brand.colour } : undefined}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {brand.viaCode && (
          <div className="mt-5 text-center">
            <button type="button" onClick={changeBusiness} className="text-muted-foreground hover:text-foreground text-sm transition-colors">
              Not {brand.name}? Change business
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
