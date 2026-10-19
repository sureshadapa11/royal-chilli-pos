import { cache } from "react";
import supabase from "@/lib/supabase";
import { DEFAULT_BUSINESS_ID } from "@/lib/business-id";
import { siteContent } from "@/lib/site-content";
import { normaliseWebsiteConfig, type SocialLinks, type WebsiteConfig } from "@/lib/website-config";

// What Staff Hub → Website → SEO & social media saved, for the public site.
// cache(): the layout, the page and their metadata all ask once per request.
export const getWebsiteConfig = cache(async (businessId: number): Promise<WebsiteConfig> => {
  const { data } = await supabase.from("businesses").select("website_config").eq("id", businessId).maybeSingle();
  return normaliseWebsiteConfig(data?.website_config);
});

/**
 * The links to show in the footer. A saved link wins; with none saved, The
 * Royal Chilli keeps the Instagram link it always had (lib/site-content.ts).
 */
export function socialLinksFor(businessId: number, config: WebsiteConfig): SocialLinks {
  const s = config.social_links;
  const anySaved = !!(s.instagram || s.facebook || s.whatsapp);
  if (anySaved || businessId !== DEFAULT_BUSINESS_ID) return s;
  return { instagram: siteContent.contact.social.instagram, facebook: "", whatsapp: "" };
}
