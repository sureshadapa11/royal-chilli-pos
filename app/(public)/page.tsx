import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Bike, Clock } from "lucide-react";
import { siteContent } from "@/lib/site-content";
import { getAboutExcerpt } from "@/lib/our-story";
import { getHeroContent, getHeroImages, getHeroMobileImages } from "@/lib/hero-content";
import { getFeaturedDishes } from "@/lib/featured-dishes";
import { pageBusinessId } from "@/lib/business";
import { getWebsiteConfig } from "@/lib/website-config-server";
import { formatCurrency } from "@/lib/utils";
import HeroBackground from "@/components/site/HeroBackground";
import Reveal from "@/components/site/Reveal";
import ShimmerHeadline from "@/components/site/ShimmerHeadline";
import TodayHours from "@/components/site/TodayHours";

// Staff Hub → Website → SEO & social media wins when it's filled in; until
// then, the wording below.
const DEFAULT_TITLE = "The Royal Chilli — Authentic Indian Cuisine in Hounslow, London";
const DEFAULT_DESCRIPTION = "Authentic North and South Indian cuisine in the heart of Hounslow, London. Order online for collection or delivery, book a table, or scan the QR code at your table.";

// "/gallery/Nalli_Gosht_Biryani_Special.webp" → "Nalli Gosht Biryani Special
// at The Royal Chilli, Hounslow" — the photo's description for search
// engines and screen readers.
function photoAlt(src: string): string {
  const name = decodeURIComponent(src.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return name ? `${name} at The Royal Chilli, Hounslow` : "The Royal Chilli, Hounslow";
}

export async function generateMetadata(): Promise<Metadata> {
  const config = await getWebsiteConfig(await pageBusinessId()).catch(() => null);
  const title = config?.seo_title || DEFAULT_TITLE;
  const description = config?.seo_description || DEFAULT_DESCRIPTION;
  return {
    // absolute: the homepage's own title, not run through any page template.
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      images: [config?.og_image_url
        ? { url: config.og_image_url, alt: "The Royal Chilli" }
        : { url: "/og/home.jpg", width: 1200, height: 630, alt: "The Royal Chilli" }],
    },
  };
}

export default async function HomePage() {
  const { differentiators, testimonials, reservation, galleryImages, popularDishes } = siteContent;
  // All at once, not one after another — each is its own database trip.
  const businessId = await pageBusinessId();
  const [about, hero, heroImages, heroMobileImages, featuredDishes] = await Promise.all([
    getAboutExcerpt(businessId),
    getHeroContent(businessId),
    getHeroImages(businessId),
    getHeroMobileImages(businessId),
    getFeaturedDishes(businessId),
  ]);

  return (
    <div>
      {/* Hero — full-bleed rotating food photo (tall ones on phones), kept
          bright: the dark fade sits only behind the text. Phones: headline at
          the top, buttons at the bottom, food clear in between. Wider
          screens: everything on the left. */}
      <section className="relative flex min-h-[100svh] items-center overflow-hidden bg-neutral-950">
        <div className="absolute inset-0">
          <HeroBackground images={heroImages} mobileImages={heroMobileImages} />
        </div>
        <div className="pointer-events-none absolute inset-0 max-sm:bg-[linear-gradient(to_bottom,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.6)_40%,rgba(0,0,0,0.1)_58%,rgba(0,0,0,0.35)_74%,rgba(0,0,0,0.9)_100%)] sm:bg-gradient-to-r sm:from-black/80 sm:via-black/45 sm:to-transparent" />

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col px-6 max-sm:min-h-[100svh] max-sm:justify-between max-sm:pb-10 max-sm:pt-24 sm:px-10">
          {/* The small line is part of the heading so search engines read
              "Indian Restaurant in Hounslow" — what people type — alongside
              the headline set in Staff Hub. */}
          <h1 className="max-w-2xl font-[family-name:var(--font-playfair)] text-4xl font-semibold leading-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] max-sm:text-[2.15rem] sm:text-6xl lg:text-7xl">
            <span className="mb-3 block font-[family-name:var(--font-jost)] text-xs font-medium uppercase not-italic tracking-[0.3em] text-white/80 sm:text-sm">
              Indian Restaurant in Hounslow
            </span>
            <span className="block">{hero.headline}</span>
            <ShimmerHeadline text={hero.headlineGold} className="italic" />
          </h1>

          {/* Phones show the info line above the buttons (column-reverse). */}
          <div className="flex flex-col max-sm:flex-col-reverse sm:mt-7">
            <div className="flex items-center gap-3 sm:flex-wrap">
              <Link
                href="/reservations"
                className="flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-xs font-semibold uppercase tracking-[0.15em] text-primary-foreground shadow-lg transition hover:opacity-90 max-sm:flex-1 max-sm:px-3"
              >
                Book a Table <ArrowRight size={16} />
              </Link>
              <Link
                href="/order"
                className="flex items-center justify-center gap-2 rounded-full border border-white/60 px-6 py-3.5 text-xs uppercase tracking-[0.15em] text-white backdrop-blur-sm transition hover:bg-white/20 max-sm:flex-1 max-sm:px-3"
              >
                <Bike size={16} /> Order Online
              </Link>
            </div>

            {/* What people nearby search for: halal, parking, today's hours. */}
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs uppercase tracking-[0.12em] text-white/85 max-sm:mb-4 max-sm:mt-0">
              <span>Halal</span><span aria-hidden className="text-white/40">·</span>
              <span>Free parking</span><span aria-hidden className="text-white/40">·</span>
              <span className="flex items-center gap-1.5"><Clock size={13} /> Open today <TodayHours /></span>
            </p>
          </div>
        </div>
      </section>

      {/* Most Popular Dishes */}
      <section className="mx-auto max-w-5xl px-4 pb-12 pt-24">
        <Reveal className="text-center">
          <h2 className="font-[family-name:var(--font-playfair)] text-3xl sm:text-4xl">
            {popularDishes.title}
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-muted-foreground">{popularDishes.story}</p>
        </Reveal>
        {featuredDishes.length > 0 ? (
          <Reveal delay={100} className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3">
            {featuredDishes.map((d) => (
              <div key={d.id}>
                <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-neutral-950">
                  <Image src={d.image_url} alt={d.name} fill sizes="(min-width: 640px) 33vw, 50vw" className="object-cover transition hover:scale-105" />
                </div>
                <h3 className="mt-3 font-[family-name:var(--font-playfair)] text-lg">{d.name}</h3>
                {d.blurb && <p className="mt-1 text-sm text-muted-foreground">{d.blurb}</p>}
                <p className="mt-1 text-sm font-semibold text-primary">from {formatCurrency(d.price)}</p>
              </div>
            ))}
          </Reveal>
        ) : (
          // Fallback to the original poster-style grid until staff add at
          // least one real featured dish via Staff Hub.
          <Reveal delay={100} className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {popularDishes.images.map((src) => (
              <div key={src} className="relative aspect-[4/5] overflow-hidden rounded-xl bg-neutral-950">
                <Image src={src} alt={photoAlt(src)} fill sizes="(min-width: 640px) 33vw, 50vw" className="object-contain transition hover:scale-105" />
              </div>
            ))}
          </Reveal>
        )}
      </section>

      {/* About */}
      <section id="about" className="mx-auto max-w-5xl px-4 pb-12 pt-24">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <Reveal>
            <p className="text-xs uppercase tracking-[0.3em] text-primary">Our Story</p>
            <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl sm:text-4xl">
              {about.title} <span className="italic text-primary">{about.titleGold}</span>
            </h2>
            <p className="mt-6 text-muted-foreground">{about.text1}</p>
            <p className="mt-4 text-muted-foreground">{about.text2}</p>
            <Link href="/about" className="mt-6 inline-block text-xs uppercase tracking-[0.15em] text-primary hover:underline">
              Read More →
            </Link>
          </Reveal>
          <Reveal delay={150} className="relative aspect-square overflow-hidden rounded-2xl">
            <Image
              src="/gallery/Tandoori_Sizzler.webp"
              alt="Tandoori Sizzler"
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </Reveal>
        </div>
      </section>

      {/* What Makes Us Different */}
      <section className="bg-card px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal className="text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-primary">Why Royal Chilli</p>
            <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl sm:text-4xl">
              What Makes Us <span className="italic text-primary">Different</span>
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {differentiators.map((d, i) => (
              <Reveal key={d.title} delay={i * 60} className="border border-border bg-background p-6">
                <h3 className="font-[family-name:var(--font-playfair)] text-lg">{d.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{d.items?.join(" · ") ?? d.text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <Reveal className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">Gallery</p>
          <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl sm:text-4xl">
            From Our <span className="italic text-primary">Kitchen</span>
          </h2>
        </Reveal>
        <Reveal delay={100} className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {galleryImages.map((src) => (
            <div key={src} className="relative aspect-square overflow-hidden rounded-xl">
              <Image src={src} alt={photoAlt(src)} fill sizes="(min-width: 640px) 25vw, 50vw" className="object-cover transition hover:scale-105" />
            </div>
          ))}
        </Reveal>
        <div className="mt-8 text-center">
          <Link href="/gallery" className="text-xs uppercase tracking-[0.15em] text-primary hover:underline">
            See Full Gallery
          </Link>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-card px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal className="text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-primary">Reviews</p>
            <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl sm:text-4xl">
              What Our <span className="italic text-primary">Guests Say</span>
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 80} className="border border-border bg-background p-6 text-center">
                <div className="text-primary">{"★".repeat(t.stars)}</div>
                <p className="mt-4 text-sm text-muted-foreground">&ldquo;{t.text}&rdquo;</p>
                <div className="mx-auto mt-5 h-px w-8 bg-primary/30" />
                <p className="mt-5 text-sm">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.platform}</p>
              </Reveal>
            ))}
          </div>
          <div className="mt-8 text-center">
            <a
              href={siteContent.contact.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs uppercase tracking-[0.15em] text-primary hover:underline"
            >
              See All Reviews
            </a>
          </div>
        </div>
      </section>

      {/* Reservation CTA */}
      <section className="mx-auto max-w-3xl px-4 py-24 text-center">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.3em] text-primary">{reservation.tag}</p>
          <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl sm:text-4xl">
            {reservation.title} <span className="italic text-primary">{reservation.titleGold}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{reservation.desc}</p>
          <Link
            href="/reservations"
            className="mt-8 inline-block border border-primary px-8 py-3 text-xs uppercase tracking-[0.15em] text-primary transition hover:bg-primary hover:text-primary-foreground"
          >
            Book Now
          </Link>
        </Reveal>
      </section>

      {/* Find Us — the map embed URL already existed in siteContent but was
          never actually rendered anywhere on the site. */}
      <section className="bg-card px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <Reveal className="text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-primary">Find Us</p>
            <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl sm:text-4xl">
              Visit <span className="italic text-primary">The Royal Chilli</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{siteContent.contact.address}</p>
          </Reveal>
          <Reveal delay={100} className="mt-10 overflow-hidden rounded-2xl border border-border">
            <iframe
              src={siteContent.contact.mapEmbed}
              title="The Royal Chilli location"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-[360px] w-full"
            />
          </Reveal>
          <div className="mt-6 text-center">
            <a
              href={siteContent.contact.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block border border-primary px-8 py-3 text-xs uppercase tracking-[0.15em] text-primary transition hover:bg-primary hover:text-primary-foreground"
            >
              Get Directions
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
