import { getBusinessSetting } from "@/lib/business-settings";

export type HeroContent = { tag: string; headline: string; headlineGold: string; description: string };

export async function getHeroContent(businessId: number): Promise<HeroContent> {
  const value = await getBusinessSetting(businessId, "hero_content");
  return value as HeroContent;
}

export async function getHeroImages(businessId: number): Promise<string[]> {
  const value = await getBusinessSetting(businessId, "hero_images");
  return (value as string[] | undefined) ?? [];
}

// Tall photos for phones (portrait screens); empty = phones get the wide ones.
export async function getHeroMobileImages(businessId: number): Promise<string[]> {
  const value = await getBusinessSetting(businessId, "hero_images_mobile");
  return Array.isArray(value) ? (value as string[]) : [];
}
