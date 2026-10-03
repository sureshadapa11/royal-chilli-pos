import { NextRequest } from "next/server";

const inserted: Record<string, unknown>[] = [];
jest.mock("@/lib/business-db", () => ({
  __esModule: true,
  bizDb: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve({ error: null }); },
      delete: () => ({ lt: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));
jest.mock("@/lib/business", () => ({ __esModule: true, websiteBusinessId: () => Promise.resolve(1) }));

import { POST } from "@/app/api/track/route";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const send = (body: unknown, ua = CHROME, ip = "203.0.113.5") =>
  POST(new NextRequest("https://www.theroyalchilli.com/api/track", {
    method: "POST",
    headers: { "user-agent": ua, "x-forwarded-for": ip, host: "www.theroyalchilli.com", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

beforeEach(() => { inserted.length = 0; });

describe("POST /api/track", () => {
  it("records the page without its query string, and only another site's name as referrer", async () => {
    expect((await send({ path: "/order/confirmation?order=123&phone=0770", ref: "https://www.google.com/search?q=curry" })).status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ path: "/order/confirmation", referrer: "google.com" });
    expect(String(inserted[0].visitor)).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(inserted[0])).not.toContain("203.0.113.5");
  });

  it("gives the same visitor the same id on the same day, and different people different ids", async () => {
    await send({ path: "/" });
    await send({ path: "/menu" });
    await send({ path: "/" }, CHROME, "198.51.100.9");
    expect(inserted[0].visitor).toBe(inserted[1].visitor);
    expect(inserted[2].visitor).not.toBe(inserted[0].visitor);
  });

  it("ignores bots, staff and till pages, our own site as referrer, and junk", async () => {
    await send({ path: "/" }, "Googlebot/2.1 (+http://www.google.com/bot.html)");
    await send({ path: "/staff/website" });
    await send({ path: "/pos" });
    await send({ path: "https://evil.example/" });
    await send(null);
    expect(inserted).toHaveLength(0);
    await send({ path: "/menu", ref: "https://www.theroyalchilli.com/" });
    expect(inserted[0].referrer).toBeNull();
  });
});
