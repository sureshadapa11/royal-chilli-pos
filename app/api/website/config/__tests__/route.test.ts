import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: require("@/app/api/_test-helpers/fake-supabase").fakeSupabase,
}));

import { fakeDb } from "@/app/api/_test-helpers/fake-supabase";
import { authedRequest } from "@/app/api/_test-helpers";
import { GET, POST } from "@/app/api/website/config/route";

const manager: SessionUser = { id: 10, name: "Manager", role: "manager", businessId: 1 };
const admin: SessionUser = { id: 11, name: "Admin", role: "admin", businessId: 1 };
const otherManager: SessionUser = { id: 20, name: "Melt Manager", role: "manager", businessId: 2 };
const owner: SessionUser = { id: 26, name: "Owner", role: "admin", businessId: 1, owner: true };
const employee: SessionUser = { id: 30, name: "Employee", role: "employee", businessId: 1 };
const driver = { id: 31, name: "Driver", role: "driver", businessId: 1 } as unknown as SessionUser;

const URL_ = "http://localhost/api/website/config";
const get = async (user: SessionUser | null, query = "") => GET((await authedRequest(URL_ + query, user)) as NextRequest);
const post = async (user: SessionUser | null, body: unknown) =>
  POST((await authedRequest(URL_, user, { method: "POST", body: JSON.stringify(body) })) as NextRequest);

const business = (id: number) => fakeDb.rows("businesses").find((b) => b.id === id)!;

beforeEach(() => {
  fakeDb.reset({
    businesses: [
      {
        id: 1, name: "The Royal Chilli", tagline: "Authentic Flavours", logo_url: "https://cdn.example/rc.png",
        domain: "theroyalchilli.com", custom_domain: null,
        modules: { website: true, online_ordering: false, qr_ordering: true, delivery: true, delivery_platforms: true },
        website_config: { homepage_hours: "Every day, 9:00 AM – 1:00 AM", social_links: { instagram: "https://instagram.com/rc" } },
      },
      {
        id: 2, name: "Melt House", tagline: null, logo_url: null, domain: "melthouse.co.uk", custom_domain: null,
        modules: { website: true, online_ordering: true }, website_config: { special_promo: "Melt secret" },
      },
    ],
    role_permissions: [],
    audit_logs: [],
  });
});

describe("GET /api/website/config", () => {
  it("returns the signed-in business's config, filled out to the full shape", async () => {
    const res = await get(manager);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.business).toMatchObject({ id: 1, name: "The Royal Chilli", domain: "theroyalchilli.com" });
    expect(d.config.homepage_hours).toBe("Every day, 9:00 AM – 1:00 AM");
    expect(d.config.social_links).toEqual({ instagram: "https://instagram.com/rc", facebook: "", whatsapp: "" });
    expect(d.config.gallery_enabled).toBe(true);
    expect(d.modules.online_ordering).toBe(false);
    expect(d.canToggleOrdering).toBe(false);
    expect(JSON.stringify(d)).not.toContain("Melt secret");
  });

  it("requires a login", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("refuses employees and drivers", async () => {
    expect((await get(employee)).status).toBe(403);
    expect((await get(driver)).status).toBe(403);
  });

  it("blocks reading another business's config unless you're the group owner", async () => {
    expect((await get(manager, "?businessId=2")).status).toBe(403);
    expect((await get(admin, "?businessId=2")).status).toBe(403);
    const res = await get(owner, "?businessId=2");
    expect(res.status).toBe(200);
    expect((await res.json()).config.special_promo).toBe("Melt secret");
  });

  it("allows naming your own business and rejects a bad id", async () => {
    expect((await get(manager, "?businessId=1")).status).toBe(200);
    expect((await get(owner, "?businessId=abc")).status).toBe(400);
    expect((await get(owner, "?businessId=99")).status).toBe(404);
  });
});

describe("POST /api/website/config", () => {
  it("saves homepage + SEO fields for the signed-in business only", async () => {
    const res = await post(otherManager, {
      config: { special_promo: "  2-for-1 shakes  ", seo_title: "Melt House | Desserts in Hounslow", gallery_enabled: false },
    });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.config.special_promo).toBe("2-for-1 shakes");
    expect(business(2).website_config).toMatchObject({ special_promo: "2-for-1 shakes", gallery_enabled: false });
    // Business 1 is untouched.
    expect(business(1).website_config).toEqual({
      homepage_hours: "Every day, 9:00 AM – 1:00 AM", social_links: { instagram: "https://instagram.com/rc" },
    });
    expect(fakeDb.rows("audit_logs")).toEqual([
      expect.objectContaining({ business_id: 2, action: "website_config_saved", staff_id: 20 }),
    ]);
  });

  it("keeps fields that weren't sent", async () => {
    await post(manager, { config: { about: "Hyderabadi kitchen" } });
    expect(business(1).website_config).toMatchObject({
      about: "Hyderabadi kitchen", homepage_hours: "Every day, 9:00 AM – 1:00 AM",
      social_links: { instagram: "https://instagram.com/rc" },
    });
  });

  it("refuses to save to another business", async () => {
    const res = await post(manager, { businessId: 2, config: { special_promo: "Hijack" } });
    expect(res.status).toBe(403);
    expect(business(2).website_config).toEqual({ special_promo: "Melt secret" });
  });

  it("refuses employees and drivers", async () => {
    expect((await post(employee, { config: { special_promo: "x" } })).status).toBe(403);
    expect((await post(driver, { config: { special_promo: "x" } })).status).toBe(403);
    expect((await post(null, { config: { special_promo: "x" } })).status).toBe(401);
    expect(business(1).website_config).not.toHaveProperty("special_promo");
  });

  it("validates lengths and links", async () => {
    const res = await post(manager, {
      config: { special_promo: "x".repeat(201), og_image_url: "javascript:alert(1)", social_links: { facebook: "not a link" } },
    });
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(Object.keys(d.fields).sort()).toEqual(["og_image_url", "social_links.facebook", "special_promo"]);
    expect(business(1).website_config).not.toHaveProperty("special_promo");
  });

  it("turns a WhatsApp number into a click-to-chat link", async () => {
    const res = await post(manager, { config: { social_links: { whatsapp: "+44 7766 177108" } } });
    expect(res.status).toBe(200);
    expect((await res.json()).config.social_links.whatsapp).toBe("https://wa.me/447766177108");
  });

  it("only lets the owner switch online ordering on or off", async () => {
    expect((await post(manager, { online_ordering: true })).status).toBe(403);
    expect((await post(admin, { online_ordering: true })).status).toBe(403);
    expect((business(1).modules as Record<string, boolean>).online_ordering).toBe(false);

    const res = await post(owner, { online_ordering: true });
    expect(res.status).toBe(200);
    expect(business(1).modules).toMatchObject({ online_ordering: true, website: true, delivery: true });
  });

  it("rejects an empty request", async () => {
    expect((await post(manager, {})).status).toBe(400);
    expect((await post(owner, { online_ordering: "yes" })).status).toBe(400);
  });
});
