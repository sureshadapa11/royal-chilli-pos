import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/types";

jest.mock("@/lib/supabase", () => ({
  __esModule: true,
  default: require("@/app/api/_test-helpers/fake-supabase").fakeSupabase,
}));

import { fakeDb, fakeSupabase } from "@/app/api/_test-helpers/fake-supabase";
import { refreshPermissionsCache } from "@/lib/permissions";
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

beforeEach(async () => {
  fakeDb.reset({
    businesses: [
      {
        id: 1, name: "The Royal Chilli", tagline: "Authentic Flavours", logo_url: "https://cdn.example/rc.png",
        domain: "theroyalchilli.com", custom_domain: null, website_config_version: 1,
        modules: { website: true, online_ordering: false, qr_ordering: true, delivery: true, delivery_platforms: true },
        website_config: { homepage_hours: "Every day, 9:00 AM – 1:00 AM", social_links: { instagram: "https://instagram.com/rc" } },
      },
      {
        id: 2, name: "Melt House", tagline: null, logo_url: null, domain: "melthouse.co.uk", custom_domain: null, website_config_version: 1,
        modules: { website: true, online_ordering: true }, website_config: { special_promo: "Melt secret" },
      },
    ],
    role_permissions: [],
    audit_logs: [],
  });
  // Empty role_permissions → the built-in defaults.
  await refreshPermissionsCache();
});

afterEach(() => jest.restoreAllMocks());

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

  it("bumps the version on every save and refuses a save based on a stale version", async () => {
    expect((await (await get(manager)).json()).version).toBe(1);

    const first = await post(manager, { version: 1, config: { about: "First" } });
    expect(first.status).toBe(200);
    expect((await first.json()).version).toBe(2);

    // A second editor still holding version 1 must not overwrite the first save.
    const stale = await post(admin, { version: 1, config: { about: "Second" } });
    expect(stale.status).toBe(409);
    expect((await stale.json()).version).toBe(2);
    expect(business(1).website_config).toMatchObject({ about: "First" });
    expect(business(1).website_config_version).toBe(2);

    // Retrying with the fresh version works and keeps the other fields.
    const retry = await post(admin, { version: 2, config: { special_promo: "Second" } });
    expect(retry.status).toBe(200);
    expect(business(1).website_config).toMatchObject({ about: "First", special_promo: "Second" });
    expect(business(1).website_config_version).toBe(3);
    expect(fakeDb.rows("audit_logs")).toHaveLength(2);
  });

  it("returns 409 when another save lands between reading and writing", async () => {
    // Simulate a concurrent save bumping the version right before our update.
    const from = fakeSupabase.from;
    jest.spyOn(fakeSupabase, "from").mockImplementation((table: string) => {
      const q = from(table) as Record<string, (...a: unknown[]) => unknown>;
      if (table !== "businesses") return q;
      const update = q.update;
      q.update = (...a: unknown[]) => { business(1).website_config_version = 5; return update(...a); };
      return q;
    });
    const res = await post(manager, { config: { about: "Lost?" } });
    expect(res.status).toBe(409);
    expect(business(1).website_config).not.toHaveProperty("about");
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });

  it("rejects a malformed version", async () => {
    expect((await post(manager, { version: "1", config: { about: "x" } })).status).toBe(400);
    expect((await post(manager, { version: 0, config: { about: "x" } })).status).toBe(400);
  });

  it("fails the save (and undoes it) when the audit log can't be written", async () => {
    const from = fakeSupabase.from;
    jest.spyOn(fakeSupabase, "from").mockImplementation((table: string) => {
      if (table !== "audit_logs") return from(table);
      return { insert: () => Promise.resolve({ data: null, error: new Error("audit down") }) } as unknown as ReturnType<typeof from>;
    });
    const res = await post(owner, { online_ordering: true, config: { about: "Unaudited" } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/audit/i);
    expect(business(1).website_config).not.toHaveProperty("about");
    expect((business(1).modules as Record<string, boolean>).online_ordering).toBe(false);
    expect(fakeDb.rows("audit_logs")).toHaveLength(0);
  });
});

describe("manager access granted through role_permissions (migration 092)", () => {
  beforeEach(async () => {
    fakeDb.tables.role_permissions = [{ role: "manager", permission: "website", granted: true }];
    await refreshPermissionsCache();
  });

  it("lets the manager read and save their business's website", async () => {
    expect((await get(manager)).status).toBe(200);
    const res = await post(manager, { config: { special_promo: "Manager promo" } });
    expect(res.status).toBe(200);
    expect(business(1).website_config).toMatchObject({ special_promo: "Manager promo" });
  });

  it("still keeps online ordering owner-only", async () => {
    expect((await post(manager, { online_ordering: true })).status).toBe(403);
    expect((business(1).modules as Record<string, boolean>).online_ordering).toBe(false);
  });

  it("denies managers once the table has rows but no website grant", async () => {
    fakeDb.tables.role_permissions = [{ role: "manager", permission: "menu", granted: true }];
    await refreshPermissionsCache();
    expect((await get(manager)).status).toBe(403);
    expect((await post(manager, { config: { about: "x" } })).status).toBe(403);
  });
});

describe("plain admin (not the group owner)", () => {
  it("reads and saves their own business's website", async () => {
    const res = await get(admin);
    expect(res.status).toBe(200);
    expect((await res.json()).canToggleOrdering).toBe(false);
    const saved = await post(admin, { config: { about: "Admin about" } });
    expect(saved.status).toBe(200);
    expect(business(1).website_config).toMatchObject({ about: "Admin about" });
  });

  it("can't read or save another business", async () => {
    expect((await get(admin, "?businessId=2")).status).toBe(403);
    expect((await post(admin, { businessId: 2, config: { about: "x" } })).status).toBe(403);
    expect(business(2).website_config).toEqual({ special_promo: "Melt secret" });
  });

  it("can't switch online ordering — that's owner-only, like Business setup → Modules", async () => {
    expect((await post(admin, { online_ordering: true })).status).toBe(403);
    expect((business(1).modules as Record<string, boolean>).online_ordering).toBe(false);
  });
});
