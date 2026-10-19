import type { Metadata } from "next";
import { siteContent } from "@/lib/site-content";
import Reveal from "@/components/site/Reveal";

export const metadata: Metadata = {
  title: "Reviews — The Royal Chilli",
  description: "Read what guests say about The Royal Chilli, the Indian restaurant on Kingsley Road, Hounslow: our Hyderabadi biryani, dosas, grills and the service.",
};

export default function ReviewsPage() {
  const { testimonials, contact } = siteContent;
  const avgStars = testimonials.reduce((s, t) => s + t.stars, 0) / testimonials.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <Reveal className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">Reviews</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl">
          What Our <span className="italic text-primary">Guests Say</span>
        </h1>
        <p className="mt-4 text-primary text-lg">{"★".repeat(Math.round(avgStars))} <span className="text-muted-foreground text-sm">({avgStars.toFixed(1)} average)</span></p>
      </Reveal>

      <div className="mt-12 space-y-4">
        {testimonials.map((t, i) => (
          <Reveal key={t.name} delay={i * 80} className="border border-border p-6">
            <div className="text-primary">{"★".repeat(t.stars)}</div>
            <p className="mt-3 text-muted-foreground">&ldquo;{t.text}&rdquo;</p>
            <p className="mt-3 text-sm">{t.name}</p>
            <p className="text-xs text-muted-foreground">{t.platform}</p>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-12 border border-border bg-card p-8 text-center">
        <h2 className="font-[family-name:var(--font-playfair)] text-xl">Enjoyed your visit?</h2>
        <p className="mt-2 text-muted-foreground">
          We&apos;d love to hear from you — leave us a review on{" "}
          <a href={contact.social.instagram} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Instagram</a>
          {" "}or{" "}
          <a href={contact.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google</a>.
        </p>
      </Reveal>
    </div>
  );
}
