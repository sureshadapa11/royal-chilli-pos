// Each business's editable website content (Staff Hub → Operations → Website),
// stored in businesses.website_config (migration 093). Shared by the API
// route and the editor so both apply the same limits.

export type SocialLinks = { instagram: string; facebook: string; whatsapp: string };

export type WebsiteConfig = {
  homepage_hours: string;
  special_promo: string;
  about: string;
  gallery_enabled: boolean;
  ordering_coming_soon: boolean;
  seo_title: string;
  seo_description: string;
  og_image_url: string;
  social_links: SocialLinks;
};

export const SOCIAL_KEYS = ["instagram", "facebook", "whatsapp"] as const;

// Hard limits (refused above these) and the lengths Google shows in full.
export const LIMITS = {
  homepage_hours: 120,
  special_promo: 200,
  about: 300,
  seo_title: 70,
  seo_description: 200,
  url: 500,
} as const;
export const SEO_RECOMMENDED = {
  seo_title: { min: 50, max: 60 },
  seo_description: { min: 150, max: 160 },
} as const;

export const EMPTY_WEBSITE_CONFIG: WebsiteConfig = {
  homepage_hours: "",
  special_promo: "",
  about: "",
  gallery_enabled: true,
  ordering_coming_soon: false,
  seo_title: "",
  seo_description: "",
  og_image_url: "",
  social_links: { instagram: "", facebook: "", whatsapp: "" },
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Whatever is stored (possibly null, partial or from an older shape) as a full config. */
export function normaliseWebsiteConfig(raw: unknown): WebsiteConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (r.social_links && typeof r.social_links === "object" ? r.social_links : {}) as Record<string, unknown>;
  return {
    homepage_hours: str(r.homepage_hours),
    special_promo: str(r.special_promo),
    about: str(r.about),
    gallery_enabled: typeof r.gallery_enabled === "boolean" ? r.gallery_enabled : EMPTY_WEBSITE_CONFIG.gallery_enabled,
    ordering_coming_soon: r.ordering_coming_soon === true,
    seo_title: str(r.seo_title),
    seo_description: str(r.seo_description),
    og_image_url: str(r.og_image_url),
    social_links: { instagram: str(s.instagram), facebook: str(s.facebook), whatsapp: str(s.whatsapp) },
  };
}

function isWebUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

const TEXT_FIELDS = ["homepage_hours", "special_promo", "about", "seo_title", "seo_description"] as const;
const BOOL_FIELDS = ["gallery_enabled", "ordering_coming_soon"] as const;

/**
 * Applies a partial update to the current config. Unknown keys are ignored;
 * text is trimmed; links must be http(s) addresses (a WhatsApp number is
 * turned into a wa.me link). Returns field errors instead when anything's wrong.
 */
export function applyWebsiteConfigUpdate(
  current: WebsiteConfig,
  input: unknown,
): { config: WebsiteConfig; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const next: WebsiteConfig = { ...current, social_links: { ...current.social_links } };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { config: next, errors: { config: "Nothing to save" } };
  }
  const v = input as Record<string, unknown>;

  for (const k of TEXT_FIELDS) {
    if (!(k in v)) continue;
    if (v[k] != null && typeof v[k] !== "string") { errors[k] = "Must be text"; continue; }
    const t = str(v[k]).trim();
    if (t.length > LIMITS[k]) errors[k] = `Keep this to ${LIMITS[k]} characters or fewer`;
    else next[k] = t;
  }
  for (const k of BOOL_FIELDS) {
    if (!(k in v)) continue;
    if (typeof v[k] !== "boolean") errors[k] = "Must be on or off";
    else next[k] = v[k] as boolean;
  }

  const url = (key: string, raw: unknown): string | null => {
    if (raw != null && typeof raw !== "string") { errors[key] = "Must be a link"; return null; }
    const t = str(raw).trim();
    if (!t) return "";
    if (t.length > LIMITS.url) { errors[key] = "That link is too long"; return null; }
    if (!isWebUrl(t)) { errors[key] = "Enter a full link starting with https://"; return null; }
    return t;
  };

  if ("og_image_url" in v) {
    const u = url("og_image_url", v.og_image_url);
    if (u !== null) next.og_image_url = u;
  }
  if ("social_links" in v) {
    const s = v.social_links;
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      errors.social_links = "Must be a list of links";
    } else {
      const links = s as Record<string, unknown>;
      for (const k of SOCIAL_KEYS) {
        if (!(k in links)) continue;
        let raw = links[k];
        // A WhatsApp number on its own ("+44 7766 177108") becomes a click-to-chat link.
        if (k === "whatsapp" && typeof raw === "string" && /^\+?[\d\s()-]{7,20}$/.test(raw.trim())) {
          raw = `https://wa.me/${raw.replace(/\D/g, "")}`;
        }
        const u = url(`social_links.${k}`, raw);
        if (u !== null) next.social_links[k] = u;
      }
    }
  }

  return { config: next, errors };
}

/** "Live" when online ordering is switched on; otherwise "Coming soon" if the business says so, else "Off". */
export function orderingStatus(onlineOrdering: boolean, comingSoon: boolean): "live" | "coming_soon" | "off" {
  if (onlineOrdering) return "live";
  return comingSoon ? "coming_soon" : "off";
}
