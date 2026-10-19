import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { siteContent } from "@/lib/site-content";
import Reveal from "@/components/site/Reveal";
import { getActiveMenu } from "@/lib/menu";
import { pageBusinessId } from "@/lib/business";
import { formatCurrency } from "@/lib/utils";
import { SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Menus — The Royal Chilli",
  description: "Explore The Royal Chilli's menus — dinner, breakfast, lunch and seasonal promotions of authentic North and South Indian cuisine in Hounslow, London.",
};

// One block per menu type, styled after tamarindrestaurant.com/menus — a
// photo + heading + short blurb + a "View Menu" link that opens the PDF in
// a new tab, rather than an inline viewer. Breakfast, Lunch and Promotions
// don't have PDFs yet, so they render as "Coming Soon" instead of a link;
// flipping one live is just adding a `pdf` field.
type MenuBlock = {
  name: string;
  description: string;
  image: string;
  pdf?: string;
};

// "DOSA MENU" → "Dosa Menu"; names already in mixed case are left alone.
const tidy = (name: string) =>
  name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name;

export default async function MenuPage() {
  // The full menu as text (the posters above are pictures, which search
  // engines can't read): the dine-in menu, at its dine-in / collection prices.
  const categories = (await getActiveMenu(await pageBusinessId(), "pos").catch(() => []))
    .filter((c) => c.items.length > 0);
  const menuSchema = categories.length > 0 && {
    "@context": "https://schema.org",
    "@type": "Menu",
    name: "The Royal Chilli menu",
    url: `${SITE_URL}/menu`,
    inLanguage: "en-GB",
    hasMenuSection: categories.map((c) => ({
      "@type": "MenuSection",
      name: tidy(c.name),
      hasMenuItem: c.items.map((i) => ({
        "@type": "MenuItem",
        name: i.name,
        ...(i.description ? { description: i.description } : {}),
        ...(i.is_veg ? { suitableForDiet: "https://schema.org/VegetarianDiet" } : {}),
        offers: { "@type": "Offer", price: Number(i.price).toFixed(2), priceCurrency: "GBP" },
      })),
    })),
  };

  const { foodPhilosophy, signatureExperiences, differentiators } = siteContent;
  const specialities = differentiators.find((d) => d.title === "Signature Specialities");
  const MENUS: MenuBlock[] = [
    {
      name: "Dinner Menu",
      description: signatureExperiences.dinner.text,
      image: "/gallery/Chicken_Dum_Biryani.webp",
      pdf: "/menu-posters/dinner.jpeg",
    },
    {
      name: "Breakfast Menu",
      description: signatureExperiences.breakfast.text,
      image: "/gallery/Masala_Wada.webp",
      pdf: "/menu-posters/breakfast.jpeg",
    },
    {
      name: "Lunch Menu",
      description: signatureExperiences.lunch.text,
      image: "/gallery/Gobi_65.webp",
      pdf: "/menu-posters/lunch.jpeg",
    },
  ];
  const specialitiesText = specialities?.items?.join(" · ") ?? null;

  return (
    <div>
      {menuSchema && (
        // eslint-disable-next-line react/no-danger -- JSON built server-side from the menu, not user HTML
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(menuSchema).replace(/</g, "\\u003c") }} />
      )}
      <Reveal className="mx-auto max-w-4xl px-4 py-16 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">Our Menus</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl">
          Taste the <span className="italic text-primary">Royal Difference</span>
        </h1>
        {specialitiesText && (
          <p className="mx-auto mt-4 max-w-xl text-sm uppercase tracking-[0.15em] text-muted-foreground">
            {specialitiesText}
          </p>
        )}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/order"
            className="inline-block border border-primary px-8 py-3 text-xs uppercase tracking-[0.15em] text-primary transition hover:bg-primary hover:text-primary-foreground"
          >
            Order Online
          </Link>
          <Link
            href="/catering"
            className="inline-block border border-border px-8 py-3 text-xs uppercase tracking-[0.15em] text-foreground transition hover:border-primary hover:text-primary"
          >
            Catering &amp; Events
          </Link>
        </div>
      </Reveal>

      {/* Food Philosophy */}
      <section className="bg-card px-4 py-16">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">Our Food Philosophy</p>
          <h2 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl">{foodPhilosophy.tag}</h2>
          <p className="mt-4 text-muted-foreground">{foodPhilosophy.intro}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {foodPhilosophy.focus.map((f) => (
              <span key={f} className="border border-primary/30 px-3 py-1.5 text-xs uppercase tracking-[0.1em] text-primary">
                {f}
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      <div className="mx-auto max-w-5xl px-4 pb-20 pt-16">
        <div className="grid gap-16">
          {MENUS.map((menu, i) => (
            <Reveal key={menu.name} className="grid items-center gap-8 md:grid-cols-2">
              <div className={`relative aspect-[4/3] overflow-hidden rounded-2xl ${i % 2 === 1 ? "md:order-2" : ""}`}>
                <Image
                  src={menu.image}
                  alt={menu.name}
                  fill
                  sizes="(min-width: 768px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div>
                <h2 className="font-[family-name:var(--font-playfair)] text-2xl">{menu.name}</h2>
                <p className="mt-3 text-muted-foreground">{menu.description}</p>
                {menu.pdf ? (
                  <a
                    href={menu.pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-block border border-primary px-6 py-2.5 text-xs uppercase tracking-[0.15em] text-primary transition hover:bg-primary hover:text-primary-foreground"
                  >
                    View Menu →
                  </a>
                ) : (
                  <span className="mt-6 inline-block border border-border px-6 py-2.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    Coming Soon
                  </span>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      {categories.length > 0 && (
        <section aria-labelledby="full-menu" className="bg-card px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <p className="text-center text-xs uppercase tracking-[0.3em] text-primary">Dine in · Collection</p>
            <h2 id="full-menu" className="mt-3 text-center font-[family-name:var(--font-playfair)] text-3xl">Full Menu</h2>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              <span className="font-semibold text-green-700">(V)</span> vegetarian. Please tell us about any allergies when you order.
            </p>
            {categories.map((c) => (
              <div key={c.id} className="mt-10">
                <h3 className="border-b border-primary/30 pb-2 font-[family-name:var(--font-playfair)] text-xl">{tidy(c.name)}</h3>
                <ul className="mt-3 divide-y divide-border/60">
                  {c.items.map((i) => (
                    <li key={i.id} className="flex items-baseline justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[15px]">
                          {i.name}
                          {!!i.is_veg && <span className="ml-1.5 text-xs font-semibold text-green-700">(V)</span>}
                        </p>
                        {i.description && <p className="mt-0.5 text-sm text-muted-foreground">{i.description}</p>}
                      </div>
                      <span className="shrink-0 tabular-nums text-[15px]">{formatCurrency(Number(i.price))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
