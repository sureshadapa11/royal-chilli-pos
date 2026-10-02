import { applyWebsiteConfigUpdate, normaliseWebsiteConfig, orderingStatus } from "@/lib/website-config";

describe("website config", () => {
  it("fills a missing or partial config out to the full shape", () => {
    expect(normaliseWebsiteConfig(null)).toMatchObject({ homepage_hours: "", gallery_enabled: true, social_links: { instagram: "", facebook: "", whatsapp: "" } });
    expect(normaliseWebsiteConfig({ gallery_enabled: false, seo_title: 5 })).toMatchObject({ gallery_enabled: false, seo_title: "" });
  });

  it("ignores unknown keys and blanks a cleared link", () => {
    const current = normaliseWebsiteConfig({ og_image_url: "https://x.test/a.png" });
    const { config, errors } = applyWebsiteConfigUpdate(current, { og_image_url: "", evil: "<script>" });
    expect(errors).toEqual({});
    expect(config.og_image_url).toBe("");
    expect(config).not.toHaveProperty("evil");
  });

  it("refuses non-http links", () => {
    const { errors } = applyWebsiteConfigUpdate(normaliseWebsiteConfig({}), { social_links: { instagram: "data:text/html,hi" } });
    expect(errors["social_links.instagram"]).toBeTruthy();
  });

  it("works out the ordering status", () => {
    expect(orderingStatus(true, true)).toBe("live");
    expect(orderingStatus(false, true)).toBe("coming_soon");
    expect(orderingStatus(false, false)).toBe("off");
  });
});
