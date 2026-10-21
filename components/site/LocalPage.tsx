import Image from "next/image";
import Link from "next/link";
import Reveal from "@/components/site/Reveal";
import { siteContent } from "@/lib/site-content";
import { formatCurrency } from "@/lib/utils";

// One of the website's "<dish / need> in Hounslow" pages (biryani, dosa, breakfast,
// halal) — what people nearby search for. Same look as the Menu page. Only
// real dishes and prices go in `sections`; nothing invented.

export type LocalDish = { name: string; price: number; note?: string | null; veg?: boolean };
export type LocalSection = { heading: string; dishes: LocalDish[]; footnote?: string };

export default function LocalPage({ kicker, title, intro, sections, points, photos = [] }: {
  kicker: string;
  title: React.ReactNode;
  intro: string[];
  sections: LocalSection[];
  /** Short facts shown as chips under the intro (Halal, parking, …). */
  points: string[];
  /** Optional dish photos from public/gallery, shown in a row under the intro. */
  photos?: { src: string; alt: string }[];
}) {
  const { contact } = siteContent;
  return (
    <div>
      <Reveal className="mx-auto max-w-3xl px-4 pb-10 pt-16 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">{kicker}</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl">{title}</h1>
        {intro.map((p) => (
          <p key={p} className="mx-auto mt-4 max-w-2xl text-muted-foreground">{p}</p>
        ))}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {points.map((p) => (
            <span key={p} className="border border-primary/30 px-3 py-1.5 text-xs uppercase tracking-[0.1em] text-primary">{p}</span>
          ))}
        </div>
      </Reveal>

      {photos.length > 0 && (
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3 px-4 pb-10">
          {photos.map((p) => (
            <div key={p.src} className="relative aspect-square overflow-hidden">
              <Image src={p.src} alt={p.alt} fill sizes="(max-width: 768px) 33vw, 250px" className="object-cover" />
            </div>
          ))}
        </div>
      )}

      {sections.filter((s) => s.dishes.length > 0).map((s) => (
        <section key={s.heading} className="bg-card px-4 py-12">
          <div className="mx-auto max-w-3xl">
            <h2 className="border-b border-primary/30 pb-2 font-[family-name:var(--font-playfair)] text-2xl">{s.heading}</h2>
            <ul className="mt-3 divide-y divide-border/60">
              {s.dishes.map((d) => (
                <li key={d.name} className="flex items-baseline justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[15px]">
                      {d.name}
                      {!!d.veg && <span className="ml-1.5 text-xs font-semibold text-green-700">(V)</span>}
                    </p>
                    {d.note && <p className="mt-0.5 text-sm text-muted-foreground">{d.note}</p>}
                  </div>
                  <span className="shrink-0 tabular-nums text-[15px]">{formatCurrency(d.price)}</span>
                </li>
              ))}
            </ul>
            {s.footnote && <p className="mt-3 text-sm text-muted-foreground">{s.footnote}</p>}
          </div>
        </section>
      ))}

      <Reveal className="mx-auto max-w-3xl px-4 py-14 text-center">
        <h2 className="font-[family-name:var(--font-playfair)] text-2xl">Find us</h2>
        <p className="mt-3 text-muted-foreground">
          {contact.address} · {contact.nearby}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <Link href="/reservations" className="inline-block border border-primary bg-primary px-8 py-3 text-xs uppercase tracking-[0.15em] text-primary-foreground transition hover:opacity-90">
            Book a Table
          </Link>
          <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="inline-block border border-border px-8 py-3 text-xs uppercase tracking-[0.15em] text-foreground transition hover:border-primary hover:text-primary">
            Call {contact.phone}
          </a>
          <Link href="/menu" className="inline-block border border-border px-8 py-3 text-xs uppercase tracking-[0.15em] text-foreground transition hover:border-primary hover:text-primary">
            Full Menu
          </Link>
        </div>
      </Reveal>
    </div>
  );
}
