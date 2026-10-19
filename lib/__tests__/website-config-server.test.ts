jest.mock("@/lib/supabase", () => ({ __esModule: true, default: {} }));
import { socialLinksFor } from "../website-config-server";
import { normaliseWebsiteConfig } from "../website-config";
import { siteContent } from "../site-content";

const withLinks = (social_links: Record<string, string>) => normaliseWebsiteConfig({ social_links });

describe("footer social links", () => {
  it("uses the links saved in Staff Hub", () => {
    expect(socialLinksFor(1, withLinks({ instagram: "https://instagram.com/rc", facebook: "https://facebook.com/rc" })))
      .toEqual({ instagram: "https://instagram.com/rc", facebook: "https://facebook.com/rc", whatsapp: "" });
  });
  it("The Royal Chilli keeps its Instagram link while nothing is saved", () => {
    expect(socialLinksFor(1, normaliseWebsiteConfig(null)).instagram).toBe(siteContent.contact.social.instagram);
  });
  it("another business shows nothing until it saves its own links", () => {
    expect(socialLinksFor(5, normaliseWebsiteConfig(null))).toEqual({ instagram: "", facebook: "", whatsapp: "" });
  });
});
