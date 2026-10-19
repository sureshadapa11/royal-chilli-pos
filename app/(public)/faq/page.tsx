import type { Metadata } from "next";
import Link from "next/link";
import { siteContent } from "@/lib/site-content";
import Reveal from "@/components/site/Reveal";
import { getOpeningHours, summarizeOpeningHours } from "@/lib/opening-hours";
import { pageBusinessId } from "@/lib/business";
import { DEFAULT_REWARD_MIN_SPEND, getLoyaltySetting, moneyShort } from "@/lib/loyalty";

export const metadata: Metadata = {
  title: "FAQ — The Royal Chilli",
  description: "Answers to common questions about The Royal Chilli, Hounslow: halal food, vegan options, parking, opening hours, delivery, catering and bookings.",
};

// Native <details>/<summary> — accessible and keyboard-operable with zero JS.
// Only questions with a confirmed, real answer are included here; group
// bookings and corkage are left out until there's an actual policy to state
// rather than a guessed one. Halal, parking and vegan confirmed by the owner
// 2026-10-19. Delivery: no online ordering yet (the module is off) — dine in,
// phone for collection, or the delivery apps.
function buildFaqs(hoursText: string, rewardMin: number) {
  return [
    { q: "Is The Royal Chilli Halal?", a: "Yes — The Royal Chilli is fully Halal." },
    { q: "Is there parking available?", a: "Yes, we have our own free car park on-site for customers." },
    { q: "Do you have vegan options?", a: "Yes — we have vegan dishes as well as a wide vegetarian menu. Just ask our team when you order and they'll point them out." },
    { q: "What are your opening hours?", a: `We're open ${hoursText}.` },
    {
      q: "Do you offer delivery and takeaway?",
      a: "Yes — dine in with us, call us to order for collection, or order delivery through Just Eat, Deliveroo or Uber Eats.",
    },
    {
      q: "Do you cater for private events or functions?",
      a: "Yes, from family celebrations to corporate catering and private functions — get in touch and our team can put together a menu to suit the occasion.",
    },
    { q: "Can I book a table in advance?", a: "Yes — you can book online any time, or call us directly." },
    {
      q: "How do I use my Rewards Club vouchers and points?",
      a: `Show your voucher code, or ask to use your points, when you pay for a dine-in meal. One reward, voucher or points discount can be used per bill${rewardMin > 0 ? `, on a bill of ${moneyShort(rewardMin)} or more before the reward` : ""}. Your codes are saved in your account under Rewards.`,
    },
  ];
}

export default async function FaqPage() {
  const summary = summarizeOpeningHours(await getOpeningHours(await pageBusinessId()));
  const hoursText = summary.length === 1
    ? `${summary[0].day.toLowerCase()}, ${summary[0].time}`
    : summary.map((h) => `${h.day} ${h.time}`).join(", ");
  const faqs = buildFaqs(hoursText, await getLoyaltySetting(await pageBusinessId(), "loyalty_reward_min_spend", DEFAULT_REWARD_MIN_SPEND));
  // The same questions for search engines and AI assistants (schema.org FAQPage).
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      {/* eslint-disable-next-line react/no-danger -- JSON built server-side from the questions above, not user HTML */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c") }} />
      <Reveal className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">FAQ</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl">
          Frequently Asked <span className="italic text-primary">Questions</span>
        </h1>
      </Reveal>

      <div className="mt-12 divide-y divide-border border-y border-border">
        {faqs.map((f, i) => (
          <Reveal key={f.q} delay={i * 60}>
            <details className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
                <span className="font-medium">{f.q}</span>
                <span className="flex-shrink-0 text-primary transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </details>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-12 border border-border bg-card p-8 text-center">
        <h2 className="font-[family-name:var(--font-playfair)] text-xl">Still have a question?</h2>
        <p className="mt-2 text-muted-foreground">
          Call us on{" "}
          <a href={`tel:${siteContent.contact.phone.replace(/\s/g, "")}`} className="text-primary hover:underline">
            {siteContent.contact.phone}
          </a>{" "}
          or message us on WhatsApp at{" "}
          <a href={`https://wa.me/${siteContent.contact.waNumber}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {siteContent.contact.waDisplay}
          </a>
          .
        </p>
        <Link
          href="/reservations"
          className="mt-6 inline-block border border-primary px-8 py-3 text-xs uppercase tracking-[0.15em] text-primary transition hover:bg-primary hover:text-primary-foreground"
        >
          Book a Table
        </Link>
      </Reveal>
    </div>
  );
}
