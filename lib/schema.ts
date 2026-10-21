import { siteContent } from "@/lib/site-content";
import type { DayHours } from "@/lib/opening-hours";

function toIntlPhone(localNumber: string): string {
  // UK-only formatter matching this one hardcoded landline — good enough
  // since there's a single contact number, not a general phone parser.
  return `+44 ${localNumber.trim().replace(/^0/, "")}`;
}

// schema.org Restaurant JSON-LD — built from the same siteContent used to
// render the page, so it can't drift from what's actually displayed.
// No aggregateRating: that needs real numbers from a live Google Places
// pull (see the reviews-are-hardcoded gap), and a fabricated rating is a
// Google Search Console penalty risk, not a quick win.
export function buildRestaurantSchema(siteUrl: string, hours: DayHours[], sameAs: string[] = [siteContent.contact.social.instagram]) {
  const { contact } = siteContent;

  // Group days that share identical open/close into one spec entry each,
  // rather than assuming every day matches (the old hardcoded behaviour).
  const groups = new Map<string, string[]>();
  for (const h of hours) {
    const key = `${h.open}|${h.close}`;
    groups.set(key, [...(groups.get(key) ?? []), h.day]);
  }
  const openingHoursSpecification = Array.from(groups.entries()).map(([key, days]) => {
    const [opens, closes] = key.split("|");
    return { "@type": "OpeningHoursSpecification", dayOfWeek: days, opens, closes };
  });

  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${siteUrl}/#restaurant`,
    name: "The Royal Chilli",
    description: `Halal Indian restaurant in Hounslow serving Hyderabadi, South Indian and North Indian food: dum biryani, dosas, tandoori grills and breakfast. ${contact.nearby}, with free on-site parking.`,
    image: [`${siteUrl}/og/home.jpg`, `${siteUrl}/splash.jpg`, `${siteUrl}/gallery/Royal_Mixed_Platter.webp`],
    url: siteUrl,
    telephone: toIntlPhone(contact.phone),
    address: {
      "@type": "PostalAddress",
      streetAddress: "43 Kingsley Road",
      addressLocality: "Hounslow",
      addressRegion: "London",
      postalCode: "TW3 1PA",
      addressCountry: "GB",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 51.4722309,
      longitude: -0.3580133,
    },
    servesCuisine: ["Indian", "South Indian", "North Indian", "Hyderabadi"],
    // Mains £6.95–£14.95 (October 2026).
    priceRange: "££",
    currenciesAccepted: "GBP",
    acceptsReservations: true,
    menu: `${siteUrl}/menu`,
    hasMenu: `${siteUrl}/menu`,
    hasMap: contact.googleMapsUrl,
    openingHoursSpecification,
    sameAs,
    // "Order online" and "Book a table" straight to our own pages.
    potentialAction: [
      {
        "@type": "OrderAction",
        target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/order`, actionPlatform: ["http://schema.org/DesktopWebPlatform", "http://schema.org/MobileWebPlatform"] },
        deliveryMethod: ["http://purl.org/goodrelations/v1#DeliveryModePickUp", "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet"],
      },
      {
        "@type": "ReserveAction",
        target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/reservations`, actionPlatform: ["http://schema.org/DesktopWebPlatform", "http://schema.org/MobileWebPlatform"] },
        result: { "@type": "FoodEstablishmentReservation", name: "Book a table" },
      },
    ],
  };
}
