import { NextRequest, NextResponse } from "next/server";
import { getBusiness } from "@/lib/business";
import { businessForToken } from "@/lib/staff-links";

// "Add to Home Screen" for a staff link: opens straight on that business's
// staff forms, full screen like an app.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const businessId = await businessForToken(token);
  if (!businessId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await getBusiness(businessId);
  const name = b?.name ?? "Staff";
  return NextResponse.json(
    {
      name: `${name} Staff`,
      short_name: `${name.split(" ").filter((w) => w.toLowerCase() !== "the").join(" ").slice(0, 10)} Staff`,
      description: `Day End and Cash In / Out for ${name} staff.`,
      start_url: `/l/${token}`,
      scope: `/l/${token}`,
      display: "standalone",
      background_color: "#fdf8ec",
      theme_color: "#e4473a",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } },
  );
}
