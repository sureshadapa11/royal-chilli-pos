import { NextRequest } from "next/server";

jest.mock("@/lib/business", () => ({
  __esModule: true,
  businessForHost: (host: string | null) =>
    Promise.resolve(
      host?.endsWith("melthouse.co.uk") ? { name: "Melt House", brand_colour: "#6B3FA0" }
        : host?.endsWith("theroyalchilli.com") ? { name: "The Royal Chilli", brand_colour: "#E34435" }
        : null
    ),
}));

import { GET } from "@/app/manifest.json/route";

const manifest = async (host: string) =>
  (await GET(new NextRequest(`https://${host}/manifest.json`, { headers: { host } }))).json();

describe("home-screen app (manifest) per address", () => {
  it("names the business and opens the Staff Hub on staff.<domain>", async () => {
    expect(await manifest("staff.melthouse.co.uk")).toMatchObject({
      name: "Melt House — Staff Hub", short_name: "Melt House", start_url: "/staff", theme_color: "#6B3FA0",
    });
  });

  it("opens the till on pos.<domain>", async () => {
    expect(await manifest("pos.theroyalchilli.com")).toMatchObject({ name: "The Royal Chilli — Till", start_url: "/pos" });
  });

  it("is neutral on the shared sign-in — never one business's name", async () => {
    const m = await manifest("crewportal.vercel.app");
    expect(m).toMatchObject({ name: "Crew Portal — Staff Hub", short_name: "Crew Portal" });
    expect(JSON.stringify(m)).not.toMatch(/Royal Chilli|Melt House|RC Staff/);
  });
});
