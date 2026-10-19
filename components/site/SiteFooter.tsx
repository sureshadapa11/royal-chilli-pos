"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { siteContent } from "@/lib/site-content";
import type { SocialLinks } from "@/lib/website-config";

// Editorial single-column footer, styled after tamarindrestaurant.com's flat
// pastel block with centered serif text and thin dividers — recolored to
// Royal Chilli's own brand hue (a blush tint of --primary) rather than
// their literal salmon, so the pattern is borrowed, not the palette.
function Divider() {
  return <div className="mx-auto my-6 h-px w-10 bg-[#3a0f0c]/25" />;
}

function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!email.trim() || saving) return;
    setSaving(true);
    try {
      await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return <p className="mt-3 text-sm text-[#3a0f0c]/80">Thanks — you&apos;re on the list.</p>;
  }

  return (
    <div className="mx-auto mt-3 flex max-w-xs gap-2">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        type="email"
        placeholder="you@email.com"
        className="w-full min-w-0 rounded-lg border border-[#3a0f0c]/25 bg-white/50 px-3 py-2 text-sm text-[#3a0f0c] outline-none placeholder:text-[#3a0f0c]/40 focus:border-[#3a0f0c]/50"
      />
      <button
        onClick={submit}
        disabled={saving}
        className="flex-shrink-0 rounded-lg bg-[#3a0f0c] px-4 py-2 text-xs uppercase tracking-[0.1em] text-[#f6ddd2] hover:opacity-90 disabled:opacity-50"
      >
        Join
      </button>
    </div>
  );
}

// social: Staff Hub → Website → SEO & social media (only the ones filled in).
// WhatsApp already has its own line in the contact details above.
export default function SiteFooter({ hours, social }: { hours: { day: string; time: string }[]; social: SocialLinks }) {
  const pathname = usePathname();
  const { contact, footer } = siteContent;
  // The account section is its own self-contained app shell (bottom tab
  // bar), same reasoning as hiding SiteHeader's hamburger there — this
  // footer's own links/newsletter block would just sit awkwardly behind
  // the fixed bottom nav.
  if (pathname?.startsWith("/account")) return null;
  return (
    <footer className="bg-[#f6ddd2] text-[#3a0f0c]">
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h3 className="font-[family-name:var(--font-cinzel)] text-lg uppercase tracking-[0.2em]">
          The Royal Chilli
        </h3>
        <p className="mx-auto mt-4 max-w-md text-sm text-[#3a0f0c]/80">{footer.tagline}</p>

        <p className="mt-8 text-xs uppercase tracking-[0.15em] text-[#3a0f0c]/70">Offers &amp; updates by email</p>
        <NewsletterForm />

        <Divider />

        <a
          href={contact.googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm hover:underline"
        >
          {contact.address}
        </a>
        <p className="mt-1 text-xs text-[#3a0f0c]/70">{contact.nearby}</p>
        <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="mt-1 block text-sm hover:underline">
          {contact.phone}
        </a>
        <a
          href={`https://wa.me/${contact.waNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block text-sm hover:underline"
        >
          WhatsApp: {contact.waDisplay}
        </a>

        <Divider />

        <ul className="space-y-1 text-sm text-[#3a0f0c]/80">
          {hours.map((h) => (
            <li key={h.day}>
              {h.day} &nbsp;·&nbsp; {h.time}
            </li>
          ))}
        </ul>

        <Divider />

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          {([["instagram", "Instagram"], ["facebook", "Facebook"]] as const).map(([k, label]) => social[k] && (
            <a
              key={k}
              href={social[k]}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]"
            >
              {label}
            </a>
          ))}
          <Link href="/about" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            About
          </Link>
          <Link href="/gallery" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            Gallery
          </Link>
          <Link href="/reservations" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            Reservations
          </Link>
          <Link href="/catering" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            Catering &amp; Events
          </Link>
          <Link href="/hyderabadi-biryani-hounslow" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            Hyderabadi Biryani
          </Link>
          <Link href="/indian-breakfast-hounslow" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            Breakfast
          </Link>
          <Link href="/halal-restaurant-hounslow" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            Halal
          </Link>
          <Link href="/careers" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            Careers
          </Link>
          <Link href="/faq" className="underline decoration-[#3a0f0c]/40 underline-offset-4 hover:decoration-[#3a0f0c]">
            FAQ
          </Link>
        </div>
      </div>
      <div className="border-t border-[#3a0f0c]/15 px-4 py-4 text-center text-xs text-[#3a0f0c]/60">
        <p>{footer.copyright}</p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <Link href="/privacy-policy" className="hover:text-[#3a0f0c]">
            Privacy Policy
          </Link>
          <span>·</span>
          <Link href="/terms" className="hover:text-[#3a0f0c]">
            Terms &amp; Conditions
          </Link>
          <span>·</span>
          <Link href="/rewards-terms" className="hover:text-[#3a0f0c]">
            Rewards Club Terms
          </Link>
          <span>·</span>
          <Link href="/login" className="hover:text-[#3a0f0c]">
            Staff Login
          </Link>
        </div>
      </div>
    </footer>
  );
}
