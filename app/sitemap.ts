import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";
// The live domain (lib/site-url.ts).
const BASE_URL = SITE_URL;

// Only the customer-facing, search-indexable pages. /order/checkout, /table/*,
// and everything under /pos, /staff, /login are transactional or private —
// deliberately excluded (and already noindexed where relevant).
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "", "/menu", "/order", "/reservations", "/gallery", "/careers", "/reviews", "/about", "/catering", "/faq",
    // What people nearby search for (October 2026).
    "/hyderabadi-biryani-hounslow", "/indian-breakfast-hounslow", "/halal-restaurant-hounslow",
  ];

  return staticRoutes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" || route === "/menu" ? "daily" : "weekly",
    priority: route === "" ? 1 : route === "/menu" ? 0.9 : 0.6,
  }));
}
