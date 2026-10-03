import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { businessByLoginCode, businessForHost } from "@/lib/business";
import { initials } from "@/lib/brand-client";

// The picture shown when a staff, till or attendance link is shared (WhatsApp
// etc.): the business's logo — or its initials in its colour — and name. The
// business comes from the address (staff.melthouse.co.uk/og), or ?code=MH
// (the attendance app points here); anything else is a neutral Crew Portal card.
export async function GET(req: NextRequest) {
  const host = req.headers.get("host");
  const code = req.nextUrl.searchParams.get("code");
  const b = (await businessForHost(host).catch(() => null)) ?? (await businessByLoginCode(code).catch(() => null));

  const name = b?.name ?? "Crew Portal";
  const colour = b?.brand_colour && /^#[0-9a-f]{6}$/i.test(b.brand_colour) ? b.brand_colour : "#c0392b";
  const logo = b?.logo_url ? new URL(b.logo_url, req.nextUrl.origin).toString() : null;
  const caption = req.nextUrl.searchParams.get("for") === "attendance" ? "Attendance" : b ? "Staff sign-in" : "Staff sign-in for your workplace";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#faf7f2", borderTop: `24px solid ${colour}` }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} width={220} height={220} style={{ borderRadius: 32, objectFit: "cover" }} alt="" />
        ) : (
          <div style={{ width: 220, height: 220, borderRadius: 32, background: colour, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 96, fontWeight: 700 }}>
            {b ? initials(name) : "CP"}
          </div>
        )}
        <div style={{ marginTop: 40, fontSize: 64, fontWeight: 700, color: "#201b18" }}>{name}</div>
        <div style={{ marginTop: 12, fontSize: 34, color: "#6b625b" }}>{caption}</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
