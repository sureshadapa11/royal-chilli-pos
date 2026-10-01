jest.mock("../supabase", () => ({
  __esModule: true,
  default: {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => Promise.resolve({
            data: [
              {
                id: 1, slug: "royal-chilli", name: "The Royal Chilli", domain: "www.theroyalchilli.com", active: true,
                logo_url: "/logo.png", brand_colour: "#E34435", address: null,
                trading_address: { line1: "43 Kingsley Road", city: "Hounslow", postcode: "TW3 1PA" },
              },
              {
                id: 2, slug: "melt-house", name: "Melt House", domain: null, active: true,
                logo_url: null, brand_colour: "#6B3FA0", address: "45 Kingsley Rd, Hounslow TW3 1PA", trading_address: null,
              },
              { id: 3, slug: "abcd", name: "ABCD", domain: null, active: false, logo_url: null, brand_colour: "red; x", address: null },
            ],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import { clearBusinessCache, listBusinesses } from "@/lib/business";
import { loginBrand } from "@/lib/login-brand";

beforeEach(() => clearBusinessCache());

describe("login screen branding", () => {
  it("an unknown domain shows no business — not The Royal Chilli", async () => {
    for (const host of ["royal-chilli-pos.vercel.app", "theroyalchili.com", "localhost:3000", null]) {
      const brand = await loginBrand(host);
      expect(brand).toEqual({ found: false });
      expect(JSON.stringify(brand)).not.toMatch(/Royal Chilli|logo\.png|Kingsley/);
    }
  });

  it("Business 1's domain shows The Royal Chilli's name, logo, colour and address", async () => {
    expect(await loginBrand("theroyalchilli.com")).toEqual({
      found: true, name: "The Royal Chilli", logoUrl: "/logo.png", colour: "#E34435", address: "43 Kingsley Road, Hounslow TW3 1PA",
    });
  });

  it("Business 2's own domain, once set, shows Business 2's branding", async () => {
    (await listBusinesses())[1].domain = "melthouse.co.uk";
    expect(await loginBrand("www.melthouse.co.uk")).toEqual({
      found: true, name: "Melt House", logoUrl: null, colour: "#6B3FA0", address: "45 Kingsley Rd, Hounslow TW3 1PA",
    });
  });

  it("?b=<slug> shows a business that has no domain yet, on any address", async () => {
    expect(await loginBrand("royal-chilli-pos.vercel.app", "melt-house")).toMatchObject({ found: true, name: "Melt House" });
    expect(await loginBrand("www.theroyalchilli.com", "melt-house")).toMatchObject({ found: true, name: "Melt House" });
    expect(await loginBrand("royal-chilli-pos.vercel.app", "abcd")).toEqual({ found: false }); // not live yet
  });

  it("ignores a brand colour that isn't a plain hex colour", async () => {
    (await listBusinesses())[2].active = true;
    expect(await loginBrand(null, "abcd")).toMatchObject({ found: true, name: "ABCD", colour: null });
  });
});
