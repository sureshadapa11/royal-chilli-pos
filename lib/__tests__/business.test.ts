jest.mock("../supabase", () => ({
  __esModule: true,
  default: {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => Promise.resolve({
            data: [
              { id: 1, slug: "royal-chilli", domain: "www.theroyalchilli.com", custom_domain: null, active: true },
              { id: 2, slug: "melt-house", domain: "melthouse.co.uk", custom_domain: "www.melthouse.com", active: true },
              { id: 3, slug: "abcd", domain: null, active: false },
              { id: 4, slug: "efgh", domain: null, active: false },
            ],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import { orderNumberPrefix, websiteBusinessId } from "@/lib/business";

describe("orderNumberPrefix", () => {
  it("gives each business its own order-number prefix", async () => {
    expect(await orderNumberPrefix(1)).toBe("RC"); // unchanged for The Royal Chilli
    expect(await orderNumberPrefix(2)).toBe("MH");
    expect(await orderNumberPrefix(3)).toBe("AB");
    expect(await orderNumberPrefix(4)).toBe("EF");
  });
});

describe("websiteBusinessId", () => {
  it("goes by the domain (with or without www, any port)", async () => {
    expect(await websiteBusinessId("www.theroyalchilli.com")).toBe(1);
    expect(await websiteBusinessId("theroyalchilli.com")).toBe(1);
    expect(await websiteBusinessId("www.melthouse.co.uk:443")).toBe(2);
  });

  it("resolves the custom domain with normalized host casing, port and www", async () => {
    expect(await websiteBusinessId("WWW.MELTHOUSE.COM:443")).toBe(2);
    expect(await websiteBusinessId("melthouse.com")).toBe(2);
  });

  it("treats unknown addresses as The Royal Chilli", async () => {
    expect(await websiteBusinessId("royal-chilli-pos.vercel.app")).toBe(1);
    expect(await websiteBusinessId(null)).toBe(1);
  });

  it("?b=<slug> picks a live business on a shared address, and is ignored otherwise", async () => {
    expect(await websiteBusinessId("royal-chilli-pos.vercel.app", "melt-house")).toBe(2);
    expect(await websiteBusinessId("royal-chilli-pos.vercel.app", "abcd")).toBe(1); // not live yet
    expect(await websiteBusinessId("www.theroyalchilli.com", "nonsense")).toBe(1);
  });
});
