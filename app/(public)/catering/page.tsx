import type { Metadata } from "next";
import { siteContent } from "@/lib/site-content";
import Reveal from "@/components/site/Reveal";

export const metadata: Metadata = {
  title: "Catering & Events — The Royal Chilli",
  description: "Indian catering in Hounslow for family celebrations, corporate and community events and private functions, with menus made for your occasion.",
};

export default function CateringPage() {
  const { catering } = siteContent.signatureExperiences;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <Reveal className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-primary">{catering.title}</p>
        <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-4xl">
          Occasions Made <span className="italic text-primary">Memorable</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{catering.text}</p>
      </Reveal>

      <Reveal delay={100} className="mt-12 border border-border bg-card p-8 text-center">
        <h2 className="font-[family-name:var(--font-playfair)] text-xl">Planning an occasion?</h2>
        <p className="mt-2 text-muted-foreground">
          Call us on{" "}
          <a href={`tel:${siteContent.contact.phone.replace(/\s/g, "")}`} className="text-primary hover:underline">
            {siteContent.contact.phone}
          </a>
          {" "}or message us on WhatsApp at{" "}
          <a href={`https://wa.me/${siteContent.contact.waNumber}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {siteContent.contact.waDisplay}
          </a>
          {" "}to talk through your catering or event needs.
        </p>
      </Reveal>
    </div>
  );
}
