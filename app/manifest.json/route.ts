import { NextRequest, NextResponse } from "next/server";
import { businessForHost } from "@/lib/business";
import { appPrefix } from "@/lib/app-hosts";
import { shortName } from "@/lib/home-screen";

// The home-screen app ("Add to Home screen") for the address it's installed
// from: a business's own name, opening on the till for pos.<domain> and the
// Staff Hub otherwise. The shared sign-in (crewportal) and unknown addresses
// get a neutral name — never one business's.
export async function GET(req: NextRequest) {
  const host = req.headers.get("host");
  const b = await businessForHost(host).catch(() => null);
  const till = appPrefix(host) === "pos";
  const name = b?.name ?? "Crew Portal";
  const colour = b?.brand_colour && /^#[0-9a-f]{6}$/i.test(b.brand_colour) ? b.brand_colour : "#c0392b";

  return NextResponse.json(
    {
      name: till ? `${name} — Till` : `${name} — Staff Hub`,
      short_name: shortName(name, b?.login_code ?? null, till),
      description: till ? `Till for ${name}.` : `Staff Hub for ${name}.`,
      start_url: till ? "/pos" : "/staff",
      display: "standalone",
      background_color: "#0d0d0d",
      theme_color: colour,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=300" } }
  );
}
